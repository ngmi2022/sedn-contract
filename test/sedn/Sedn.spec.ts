import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployContract } from "@nomiclabs/hardhat-ethers/types";
import { addresses } from "@socket.tech/ll-core";
import { expect } from "chai";
import { BigNumber, Contract, Wallet } from "ethers";
import { ethers, network } from "hardhat";
import { it } from "mocha";

import { FakeSigner } from "../../helper/FakeSigner";
import { getSignedTxRequest } from "../../helper/signer";
import { Sedn } from "../../src/types/contracts/Sedn/Sedn.sol/Sedn";
import { restoreSnapshot, takeSnapshot } from "../utils/network";
import { deploySedn, deploySednForwarder } from "./sedn.contract";

if (!process.env.ETHERSCAN_API_KEY) {
  throw new Error("ETHERSCAN_API_KEY not set");
}

const getRequirements = async () => {
  const usdcOwnerAddress = "0x55FE002aefF02F77364de339a1292923A15844B8"; // Circle's wallet
  const circleSigner = await ethers.getImpersonatedSigner(usdcOwnerAddress); // Signer for circle's wallet
  const relayerAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik's address
  const relayer = await ethers.getImpersonatedSigner(relayerAddress); // vitalik will be impersonated and act as our relayer signer

  // instantiate etherscan api
  const api = require("etherscan-api").init(process.env.ETHERSCAN_API_KEY);

  // instantiate usdc contract
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const usdcAbiAddress = "0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF";
  const usdcAbiObject = await api.contract.getabi(usdcAbiAddress);
  type ObjectKey = keyof typeof usdcAbiObject;
  const result = "result" as ObjectKey;
  const usdcAbi = usdcAbiObject[result];
  const usdc = new ethers.Contract(usdcAddress, usdcAbi, circleSigner);

  // generate registry address for contract deployment
  const registry: string = "registry";
  const chainId: number = network.config.chainId!;
  const registryAddress: string =
    chainId !== 31337 ? addresses[chainId][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";

  return { usdc, registryAddress, circleSigner, relayer };
};

const sednUnknown = async (
  usdc: Contract,
  sedn: Contract,
  signer: SignerWithAddress,
  amount: string,
  solution?: string,
) => {
  await usdc.connect(signer).approve(sedn.address, amount);
  const beforeSedn = await usdc.balanceOf(signer.address);
  const beforeSednContract = await usdc.balanceOf(sedn.address);
  if (!solution) {
    solution = "Hello World!";
  }
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  await sedn.connect(signer).sednUnknown(amount, secret);
  const afterSedn = await usdc.balanceOf(signer.address);
  const afterSednContract = await usdc.balanceOf(sedn.address);
  expect(beforeSedn.sub(afterSedn)).to.equal(amount);
  expect(afterSednContract.sub(beforeSednContract)).to.equal(amount);
  return { solution, secret };
};

const sednKnown = async (
  usdc: Contract,
  sedn: Contract,
  signer: SignerWithAddress,
  recipient: SignerWithAddress,
  amount: string,
) => {
  // Send
  const usdcBeforeSednContract = await usdc.balanceOf(sedn.address);
  const usdcBeforeSednSender = await usdc.balanceOf(signer.address);
  const sednBeforeSednRecipient = await sedn.balanceOf(recipient.address);
  await usdc.connect(signer).approve(sedn.address, amount);
  await sedn.connect(signer).sednKnown(amount, recipient.address);
  const usdcAfterSednContract = await usdc.balanceOf(sedn.address);
  const usdcAfterSednSender = await usdc.balanceOf(signer.address);
  const sednAfterSednRecipient = await sedn.balanceOf(recipient.address);

  expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
  expect(usdcBeforeSednSender.sub(usdcAfterSednSender)).to.equal(amount);
  expect(sednAfterSednRecipient.sub(sednBeforeSednRecipient)).to.equal(amount);
};

const transferUnknown = async (sedn: Contract, signer: SignerWithAddress, amount: string, solution?: string) => {
  const sednBeforeTransferSender = await sedn.balanceOf(signer.address);
  if (!solution) {
    solution = "Hello World!";
  }
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  await sedn.connect(signer).transferUnknown(amount, secret);
  const sednAfterTransferSender = await sedn.balanceOf(signer.address);
  expect(sednBeforeTransferSender.sub(sednAfterTransferSender)).to.equal(amount);
  return { solution, secret };
};

const transferKnown = async (
  sedn: Contract,
  signer: SignerWithAddress,
  recipient: SignerWithAddress,
  amount: string,
) => {
  const sednBeforeTransferSender = await sedn.balanceOf(signer.address);
  const sednBeforeTransferClaimer = await sedn.balanceOf(recipient.address);
  await sedn.connect(signer).transferKnown(amount, recipient.address);
  const sednAfterTransferSender = await sedn.balanceOf(signer.address);
  const sednAfterTransferClaimer = await sedn.balanceOf(recipient.address);
  expect(sednBeforeTransferSender.sub(sednAfterTransferSender)).to.equal(amount);
  expect(sednAfterTransferClaimer.sub(sednBeforeTransferClaimer)).to.equal(amount);
  return;
};

const hybridUnknown = async (
  usdc: Contract,
  sedn: Contract,
  signer: SignerWithAddress,
  amount: string,
  balanceAmount: string,
  solution?: string,
) => {
  await usdc.connect(signer).approve(sedn.address, amount);
  const beforeSedn = await usdc.balanceOf(signer.address);
  const beforeSednContract = await usdc.balanceOf(sedn.address);
  const sednBeforeSigner = await sedn.balanceOf(signer.address);
  if (!solution) {
    solution = "Hello World!";
  }
  const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
  await sedn.connect(signer).hybridUnknown(amount, balanceAmount, secret);
  const afterSedn = await usdc.balanceOf(signer.address);
  const afterSednContract = await usdc.balanceOf(sedn.address);
  const sednAfterSigner = await sedn.balanceOf(signer.address);
  expect(beforeSedn.sub(afterSedn)).to.equal(amount);
  expect(afterSednContract.sub(beforeSednContract)).to.equal(amount);
  expect(sednBeforeSigner.sub(sednAfterSigner)).to.equal(balanceAmount);
  return { solution, secret };
};

const hybridKnown = async (
  usdc: Contract,
  sedn: Contract,
  signer: SignerWithAddress,
  recipient: SignerWithAddress,
  amount: string,
  balanceAmount: string,
) => {
  await usdc.connect(signer).approve(sedn.address, amount);
  const sednBeforeTransferSender = await sedn.balanceOf(signer.address);
  const sednBeforeTransferClaimer = await sedn.balanceOf(recipient.address);
  await sedn.connect(signer).hybridKnown(amount, balanceAmount, recipient.address);
  const sednAfterTransferSender = await sedn.balanceOf(signer.address);
  const sednAfterTransferClaimer = await sedn.balanceOf(recipient.address);
  const totalAmount = BigNumber.from(amount).add(BigNumber.from(balanceAmount));
  expect(sednBeforeTransferSender.sub(sednAfterTransferSender)).to.equal(amount);
  expect(sednAfterTransferClaimer.sub(sednBeforeTransferClaimer)).to.equal(totalAmount);
  return;
};

const claim = async (
  sedn: Contract,
  signer: SignerWithAddress,
  trusted: FakeSigner,
  secret: string,
  solution: string,
  amount: string,
) => {
  const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
  const signedMessage = await trusted.signMessage(BigNumber.from(amount), signer.address, till, secret);
  const signature = ethers.utils.splitSignature(signedMessage);
  const sednBalanceBeforeClaimer = await sedn.balanceOf(signer.address);
  await sedn.connect(signer).claim(solution, secret, till, signature.v, signature.r, signature.s);
  const sednBalanceAfterClaimer = await sedn.balanceOf(signer.address);
  expect(sednBalanceAfterClaimer.sub(sednBalanceBeforeClaimer)).to.equal(amount);
  return;
};

const clawback = async (sedn: Contract, signer: SignerWithAddress, secret: string) => {
  await sedn.connect(signer).clawback(secret);
  return;
};

const withdraw = async (usdc: Contract, sedn: Contract, signer: SignerWithAddress, amount: string) => {
  // Send
  const sednBeforeWithdrawSigner = await sedn.balanceOf(signer.address);
  const usdcBeforeWithdrawSigner = await usdc.balanceOf(signer.address);
  await sedn.connect(signer).withdraw(amount, signer.address);
  const sednAfterWithdrawSigner = await sedn.balanceOf(signer.address);
  const usdcAfterWithdrawSigner = await usdc.balanceOf(signer.address);
  expect(sednBeforeWithdrawSigner.sub(sednAfterWithdrawSigner)).to.equal(amount);
  expect(usdcAfterWithdrawSigner.sub(usdcBeforeWithdrawSigner)).to.equal(amount);
  return;
};

describe("Sedn", function () {
  let snap: number;
  let amount: string;
  let accounts: SignerWithAddress[];
  let owner: SignerWithAddress;
  let sender: SignerWithAddress;
  let claimer: SignerWithAddress;
  let circleSigner: SignerWithAddress;
  let trusted: FakeSigner;
  let contract: Sedn;
  let usdc: Contract;
  let forwarder: Contract;
  let registry: string;

  before(async function () {
    const requirements = await getRequirements();
    amount = "10000000";
    // accounts setup
    accounts = await ethers.getSigners();
    owner = accounts[0];
    claimer = accounts[2];
    sender = accounts[3];
    circleSigner = requirements.circleSigner;
    // other reqs
    registry = requirements.registryAddress;
    forwarder = await deploySednForwarder([], owner);
    await forwarder.deployed();
    contract = await deploySedn(
      [requirements.usdc.address, requirements.registryAddress, accounts[1].address, forwarder.address],
      owner,
    );

    trusted = new FakeSigner(accounts[1], contract.address);

    // Set up usdc in account wallets
    usdc = requirements.usdc;
    await usdc.connect(circleSigner).approve(circleSigner.address, BigNumber.from(3 * 10 ** 8));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, owner.address, BigNumber.from(10 ** 8));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, sender.address, BigNumber.from(10 ** 8));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, claimer.address, BigNumber.from(10 ** 8));
    // claimerTwo has no funds
  });

  beforeEach(async () => {
    snap = await takeSnapshot();
  });

  afterEach(async () => {
    await restoreSnapshot(snap);
  });

  describe("constructor", () => {
    it("should deploy", async () => {
      const requirements = await getRequirements();
      const forwarder = await deploySednForwarder([], owner);
      await forwarder.deployed();
      const sedn = await deploySedn([usdc.address, registry, accounts[1].address, forwarder.address], owner);
      await sedn.deployed();
      expect(await sedn.owner()).to.equal(owner.address);
      expect(await sedn.usdcToken()).to.equal(usdc.address);
      expect(await sedn.registry()).to.equal(registry);
      expect(await sedn.trustedVerifyAddress()).to.equal(trusted.getAddress());
    });
  });
  describe("sedn", () => {
    it("should send funds from a wallet to an unregistered user", async function () {
      await contract.deployed();
      // Send money
      const { solution, secret } = await sednUnknown(usdc, contract, sender, amount);
      // Claim
      await claim(contract, claimer, trusted, secret, solution, amount);
    });
    it("should sedn funds from a wallet to an unregistered user who has already received some funds", async function () {
      await contract.deployed();
      // Send money
      const { solution, secret } = await sednUnknown(usdc, contract, sender, amount);
      // Send money again
      await sednUnknown(usdc, contract, sender, amount, solution); // no need to get solution and secret again
      // Claim
      const doubleAmount = BigNumber.from(amount).mul(2).toString();
      await claim(contract, claimer, trusted, secret, solution, doubleAmount);
    });
    it("should send funds from a wallet to a registered", async function () {
      await contract.deployed();
      // Send money
      await sednKnown(usdc, contract, sender, claimer, amount);
    });
  });
  describe("transfers", () => {
    it("should transfer funds from a sednBalance to an unregistered user", async function () {
      await contract.deployed();

      // fund senders sednBalance
      await sednKnown(usdc, contract, sender, sender, amount);

      // Transfer
      const { solution, secret } = await transferUnknown(contract, sender, amount);

      // Claim
      await claim(contract, claimer, trusted, secret, solution, amount);
    });
    it("should sedn funds from a wallet to an unregistered user who has already received some funds", async function () {
      await contract.deployed();
      // fund senders sednBalance
      const doubleAmount = BigNumber.from(amount).mul(2).toString();
      await sednKnown(usdc, contract, sender, sender, doubleAmount);

      // Transfer #1
      const { solution, secret } = await transferUnknown(contract, sender, amount);

      // Transfer #2
      await transferUnknown(contract, sender, amount, solution);

      // Claim
      await claim(contract, claimer, trusted, secret, solution, doubleAmount);
    });
    it("should transfer funds from a sednBalance to a registered user", async function () {
      await contract.deployed();
      // fund senders sednBalance
      await sednKnown(usdc, contract, sender, sender, amount);

      // Send
      await transferKnown(contract, sender, claimer, amount);
    });
  });
  describe("hybrids", () => {
    it("should hybrid 'send' funds from a wallet and sednBalance to an unregistered user", async function () {
      await contract.deployed();

      // fund senders sednBalance
      const halfAmount = BigNumber.from(amount).div(2).toString();
      await sednKnown(usdc, contract, sender, sender, halfAmount);

      // Hybrid send
      const { solution, secret } = await hybridUnknown(usdc, contract, sender, halfAmount, halfAmount);

      // Claim
      await claim(contract, claimer, trusted, secret, solution, amount);
    });
    it("should hybrid 'send' funds from a wallet and sednBalance to an unregistered user who has already received some funds", async function () {
      await contract.deployed();

      // fund senders sednBalance
      const halfAmount = BigNumber.from(amount).div(2).toString();
      const doubleAmount = BigNumber.from(amount).mul(2).toString();
      await sednKnown(usdc, contract, sender, sender, amount);

      // Hybrid send #1
      const { solution, secret } = await hybridUnknown(usdc, contract, sender, halfAmount, halfAmount);

      // Hybrid send #2
      await hybridUnknown(usdc, contract, sender, halfAmount, halfAmount, solution);

      // Claim
      await claim(contract, claimer, trusted, secret, solution, doubleAmount);
    });
    it("should hybrid 'send' funds from a wallet and sednBalance to a registered", async function () {
      await contract.deployed();

      // fund senders sednBalance
      const halfAmount = BigNumber.from(amount).div(2).toString();
      await sednKnown(usdc, contract, sender, sender, halfAmount);

      // Hybrid send
      await hybridKnown(usdc, contract, sender, claimer, halfAmount, halfAmount);
    });
  });
  describe("clawback", () => {
    it("should clawback funds from a secret", async function () {
      await contract.deployed();
      const halfAmount = BigNumber.from(amount).div(2).toString();

      // Send money
      const { secret, solution } = await sednUnknown(usdc, contract, sender, halfAmount);

      // Check payment status
      const paymentAmountBefore = await contract.connect(sender).getPaymentAmount(secret);
      expect(paymentAmountBefore).to.equal(halfAmount);

      // Send money again
      await sednUnknown(usdc, contract, sender, halfAmount, solution); // no need to get solution and secret again

      // Check payment status again
      const paymentAmountMid = await contract.connect(sender).getPaymentAmount(secret);
      expect(paymentAmountMid).to.equal(amount);

      // 1st Clawback
      await clawback(contract, sender, secret);

      // Check payment status again
      const paymentAmountOne = await contract.connect(sender).getPaymentAmount(secret);
      expect(paymentAmountOne).to.equal(halfAmount);

      // Clawback again
      await clawback(contract, sender, secret);

      // Check payment status again
      const paymentAmountTwo = await contract.connect(sender).getPaymentAmount(secret);
      expect(paymentAmountTwo).to.equal("0"); // because its empty
    });
  });
  describe("withdrawals", () => {
    it("should withdraw funds from a sednBalance to the same chain", async function () {
      await contract.deployed();
      // fund senders sednBalance
      await sednKnown(usdc, contract, sender, sender, amount);
      // withdraw
      await withdraw(usdc, contract, sender, amount);
    });
    it("should withdraw funds to a different chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // fund senders sednBalance
      await usdc.connect(sender).approve(contract.address, amount);
      await contract.connect(sender).sednKnown(amount, sender.address);

      // Claim
      // construct necessary calldata for method execution
      const toChainId = 137;

      // data construct for middleware, which is not used in this test transaction
      const miWaId = 0;
      const miOpNativeAmt = 0;
      const inToken = usdc.address;
      const miData = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const middlewareRequest = [miWaId, miOpNativeAmt, inToken, miData];

      // data construct for hop bridge, which is used in this test transaction
      const briId = 12;
      const briOpNativeAmt = 0;
      const briData = "0x0000000000000000000000000000000000000000000000000000000000000000";
      const bridgeRequest = [briId, briOpNativeAmt, inToken, briData];

      // create calldata dict
      const userRequestDict: any = {
        receiverAddress: claimer.address,
        toChainId: toChainId,
        amount: amount,
        middlewareRequest: middlewareRequest,
        bridgeRequest: bridgeRequest,
      };
      // bridgeImpl
      const bridgeImpl = "0x1Aba89fC7ff67D27ccaa51893c46FD1e5fEE924B";

      // Claim
      const usdcBeforeClaimContract = await usdc.balanceOf(contract.address);
      const sednBeforeClaimSender = await contract.balanceOf(sender.address);
      await contract.connect(sender).bridgeWithdraw(amount, userRequestDict, bridgeImpl);
      const usdcAfterClaimContract = await usdc.balanceOf(contract.address);
      const sednAfterClaimSender = await contract.balanceOf(sender.address);
      expect(usdcBeforeClaimContract.sub(usdcAfterClaimContract)).to.equal(amount);
      expect(sednBeforeClaimSender.sub(sednAfterClaimSender)).to.equal(amount);
    });
  });
  describe("forwarder", () => {
    it("should relay a transaction successfully", async () => {
      await contract.deployed();
      await forwarder.deployed();
      // get balance before execution
      const sednBalanceBeforeClaimer = await contract.balanceOf(claimer.address);
      const usdcBalanceBeforeSender = await usdc.balanceOf(sender.address);

      // instantiate sender as wallet
      const senderWallet = Wallet.fromMnemonic(process.env.MNEMONIC!, "m/44'/60'/0'/0/3");

      // Sign and "Relay" --> owner acts as relayer
      const { chainId } = await sender.provider!.getNetwork();
      await usdc.connect(sender).approve(contract.address, amount);
      const blocktime = (await sender.provider!.getBlock("latest")).timestamp;
      const signedTx = await getSignedTxRequest(
        contract,
        sender,
        senderWallet.privateKey,
        "sednKnown",
        [amount, claimer.address],
        BigInt("0"),
        chainId,
        blocktime + 60 * 10,
        forwarder.address,
      );
      // const valid = await forwarder.connect(owner).verify(signedTx.request, signedTx.signature);
      // if (!valid) throw new Error("Invalid signature");
      const tx = await forwarder
        .connect(owner)
        .execute(signedTx.request, signedTx.signature, { value: signedTx.request.value });

      // balances after execution
      const sednBalanceAfterClaimer = await contract.balanceOf(claimer.address);
      const usdcBalanceAfterSender = await usdc.balanceOf(sender.address);

      // check correct balances
      expect(sednBalanceAfterClaimer.sub(sednBalanceBeforeClaimer)).to.equal(amount);
      expect(usdcBalanceBeforeSender.sub(usdcBalanceAfterSender)).to.equal(amount);
    });
    it("should throw an error when a incorrect chain is specified", async () => {
      await contract.deployed();
      await forwarder.deployed();

      // instantiate sender as wallet
      const senderWallet = Wallet.fromMnemonic(process.env.MNEMONIC!, "m/44'/60'/0'/0/3");

      // Sign and "Relay" --> owner acts as relayer
      await usdc.connect(sender).approve(contract.address, amount);
      const blocktime = (await sender.provider!.getBlock("latest")).timestamp;
      const signedTx = await getSignedTxRequest(
        contract,
        sender,
        senderWallet.privateKey,
        "sednKnown",
        [amount, claimer.address],
        BigInt("0"),
        420,
        blocktime + 60 * 10,
        forwarder.address,
      );
      try {
        await forwarder.connect(owner).verify(signedTx.request, signedTx.signature);
      } catch (e) {
        expect(e.reason.includes("SednForwarder: wrong chainId"));
      }
      try {
        await forwarder.connect(owner).execute(signedTx.request, signedTx.signature, { value: signedTx.request.value });
      } catch (e) {
        expect(JSON.stringify(e).includes("SednForwarder: wrong chainId"));
      }
    });
  });
});
