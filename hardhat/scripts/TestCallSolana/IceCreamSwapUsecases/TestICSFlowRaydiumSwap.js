//
//
// Test purpose - in this script we will be performing a swap in Raydium DEX. Input swap token is WSOL and output swap token is USDC. In order to initiate the swap the contract's account must have both ATA's initialized before the swap execution ( ATA for WSOL and ATA for USDC )
// !!! Important !!! - Raydium does not support the Solana's Devnet chain thus this tutorial is built on top of Solana Mainnet.
// Note - some of the logic used for this swap test is placed inside the config.js file inside the config.raydiumHelper object.
//
//

const { ethers } = require("hardhat");
const web3 = require("@solana/web3.js");
const {
    getAssociatedTokenAddress
} = require('@solana/spl-token');
const {
    Liquidity
} = require('@raydium-io/raydium-sdk');
const { config } = require('../config');

async function main() {
    const [user1] = await ethers.getSigners();
    const connection = new web3.Connection(config.SOLANA_NODE_MAINNET, "processed");

    const swapConfig = {
        tokenAAmount: 0.0001, // Swap 0.0001 SOL for USDC in this example
        TokenA: "So11111111111111111111111111111111111111112", // WSOL
        TokenB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
        TokenADecimals: 9,
        direction: "in", // Swap direction: 'in' or 'out'
        liquidityFile: "https://api.raydium.io/v2/sdk/liquidity/mainnet.json",
        slippage: 1 // percents
    };

    const TestICSFlowFactory = await ethers.getContractFactory("TestICSFlow");
    let TestICSFlowAddress = config.ICS_FLOW_MAINNET;
    let TestICSFlow;
    let tx;

    if (ethers.isAddress(TestICSFlowAddress)) {
        TestICSFlow = TestICSFlowFactory.attach(TestICSFlowAddress);
    } else {
        TestICSFlow = await ethers.deployContract("TestICSFlow");
        await TestICSFlow.waitForDeployment();

        TestICSFlowAddress = TestICSFlow.target;
        console.log(
            `TestICSFlow deployed to ${TestICSFlow.target}`
        );
    }

    const contractPublicKeyInBytes = await TestICSFlow.getNeonAddress(TestICSFlowAddress);
    const contractPublicKey = ethers.encodeBase58(contractPublicKeyInBytes);
    console.log(contractPublicKey, 'contractPublicKey');

    let ataContract = await getAssociatedTokenAddress(
        new web3.PublicKey(swapConfig.TokenA),
        new web3.PublicKey(contractPublicKey),
        true
    );
    const ataContractInfo = await connection.getAccountInfo(ataContract);

    const user1USDCTokenAccount = config.utils.calculateTokenAccount(
        config.TOKENS.ADDRESSES.USDC,
        user1.address,
        new web3.PublicKey('NeonVMyRX5GbCrsAHnUwx1nYYoJAtskU1bWUo6JGNyG')
    );

    // in order to proceed with swap the executor account needs to have existing ATA account
    if (!ataContractInfo) {
        return console.error('Account ' + contractPublicKey + ' does not have initialized ATA account for TokenA ( ' + swapConfig.TokenA + ' ).');
    }

    const WSOL = new ethers.Contract(
        config.TOKENS.ADDRESSES.WSOL,
        config.TOKENS.ABIs.ERC20ForSPL,
        ethers.provider
    );

    console.log('\nQuery Raydium pools data ...');
    const poolKeys = await config.raydiumHelper.findPoolInfoForTokens(swapConfig.liquidityFile, swapConfig.TokenA, swapConfig.TokenB);
    if (!poolKeys) {
        console.error('Pool info not found');
        return 'Pool info not found';
    } else {
        console.log('Found pool info');
    }
    
    const directionIn = poolKeys.quoteMint.toString() == swapConfig.TokenB;
    const [amountIn, , minAmountOut] = await config.raydiumHelper.calcAmountOut(Liquidity, connection, poolKeys, swapConfig.tokenAAmount, directionIn, swapConfig.slippage);
    console.log(minAmountOut, 'minAmountOut');
    console.log(amountIn, 'amountIn');

    const raydiumSwap = Liquidity.makeSwapInstruction({
        poolKeys: poolKeys,
        userKeys: {
            tokenAccountIn: ataContract,
            tokenAccountOut: user1USDCTokenAccount[0],
            owner: new web3.PublicKey(contractPublicKey)
        },
        amountIn: amountIn.raw,
        amountOut: minAmountOut.raw,
        fixedSide: "in"
    });

    console.log('\nBroadcast WSOL approval ... ');
    tx = await WSOL.connect(user1).approve(TestICSFlowAddress, swapConfig.tokenAAmount * 10 ** swapConfig.TokenADecimals);
    await tx.wait(1);
    console.log(tx, 'tx');

    console.log('\nBroadcast Raydium swap WSOL -> USDC ... ');
    tx = await TestICSFlow.connect(user1).execute(
        config.TOKENS.ADDRESSES.WSOL,
        config.TOKENS.ADDRESSES.USDC,
        swapConfig.tokenAAmount * 10 ** swapConfig.TokenADecimals,
        ethers.zeroPadValue(ethers.toBeHex(ethers.decodeBase58(ataContract.toBase58())), 32),
        0, 
        '0x0000000000000000000000000000000000000000000000000000000000000000',
        config.utils.prepareInstructionData(raydiumSwap.innerTransaction.instructions[0])
    );
    await tx.wait(1);
    console.log(tx, 'tx');
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});