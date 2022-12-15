import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { addresses } from "@socket.tech/ll-core";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers, network } from "hardhat";
import { it } from "mocha";

import { FakeSigner } from "../../helper/FakeSigner";
import { deploySedn } from "../../integration/sedn.contract";
import { Sedn } from "../../src/types/contracts/Sedn.sol/Sedn";
import { restoreSnapshot, takeSnapshot } from "../utils/network";

if (!process.env.ETHERSCAN_API_KEY) {
  throw new Error("ETHERSCAN_API_KEY not set");
}

const getRequirements = async () => {
  const usdcOwnerAddress = "0x55FE002aefF02F77364de339a1292923A15844B8"; // Circle's wallet
  const circleSigner = await ethers.getImpersonatedSigner(usdcOwnerAddress); // Signer for circle's wallet
  const relayerAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik's address
  const relayer = await ethers.getImpersonatedSigner(relayerAddress); // vitalik will be impersonated and act as our relayer signer
  const name = "sednUSDC";
  const symbol = "sdnUSDC";

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

  // instantiate minimalForwarder contract
  const forwarderAddress: string = "0x67c67a22d80466638a5d26Cd921Efb18F2C09b57";
  const minimalForwarderAbiObject = await api.contract.getabi(forwarderAddress);
  const minimalForwarderAbi = minimalForwarderAbiObject[result];
  const minimalForwarder = new ethers.Contract(forwarderAddress, minimalForwarderAbi, relayer);

  // generate registry address for contract deployment
  const registry: string = "registry";
  const chainId: number = network.config.chainId!;
  const registryAddress: string =
    chainId !== 31337 ? addresses[chainId][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";

  return { usdc, registryAddress, circleSigner, forwarderAddress, minimalForwarder, relayer, name, symbol };
};

describe("Sedn", function () {
  let snap: number;
  let accounts: SignerWithAddress[];
  let owner: SignerWithAddress;
  let sender: SignerWithAddress;
  let claimer: SignerWithAddress;
  let claimerTwo: SignerWithAddress;
  let circleSigner: SignerWithAddress;
  let trusted: FakeSigner;
  let contract: Sedn;
  let usdc: Contract;
  let registry: string;

  before(async function () {
    const requirements = await getRequirements();

    // accounts setup
    accounts = await ethers.getSigners();
    owner = accounts[0];
    claimer = accounts[2];
    sender = accounts[3];
    claimerTwo = accounts[4];
    circleSigner = requirements.circleSigner;
    // other reqs
    registry = requirements.registryAddress;
    contract = await deploySedn(
      [
        requirements.usdc.address,
        requirements.registryAddress,
        accounts[1].address,
        requirements.name,
        requirements.symbol,
        requirements.forwarderAddress,
      ],
      owner,
    );
    trusted = new FakeSigner(accounts[1], contract.address);

    // Set up usdc in account wallets
    usdc = requirements.usdc;
    await usdc.connect(circleSigner).approve(circleSigner.address, BigNumber.from(3 * 10 ** 7));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, owner.address, BigNumber.from(10 ** 7));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, sender.address, BigNumber.from(10 ** 7));
    await usdc.connect(circleSigner).transferFrom(circleSigner.address, claimer.address, BigNumber.from(10 ** 7));
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
      const sedn = await deploySedn(
        [
          usdc.address,
          registry,
          accounts[1].address,
          requirements.name,
          requirements.symbol,
          requirements.forwarderAddress,
        ],
        owner,
      );
      await sedn.deployed();
      expect(await sedn.owner()).to.equal(owner.address);
      expect(await sedn.usdcToken()).to.equal(usdc.address);
      expect(await sedn.registry()).to.equal(registry);
      expect(await sedn.name()).to.equal(requirements.name);
      expect(await sedn.symbol()).to.equal(requirements.symbol);
      expect(await sedn.trustedVerifyAddress()).to.equal(trusted.getAddress());
    });
  });
  describe("sedn", () => {
    it("should send funds from a wallet to an unregistered user on the same chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // Send money
      await usdc.connect(sender);
      await usdc.connect(sender).approve(contract.address, amount);
      const beforeSedn = await usdc.balanceOf(sender.address);
      const solution = "Hello World!";
      const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
      await contract.connect(sender).sednUnknown(amount, secret);
      const afterSedn = await usdc.balanceOf(sender.address);
      expect(beforeSedn.sub(afterSedn)).to.equal(amount);
      expect(await usdc.balanceOf(contract.address)).to.equal(amount);

      // Claim
      const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
      const signedMessage = await trusted.signMessage(BigNumber.from(amount), claimer.address, till, secret);
      const signature = ethers.utils.splitSignature(signedMessage);
      const sednBalanceBeforeClaimer = await contract.balanceOf(claimer.address);
      await contract.connect(claimer).claim(solution, secret, till, signature.v, signature.r, signature.s);
      const sednBalanceAfterClaimer = await contract.balanceOf(claimer.address);
      expect(sednBalanceAfterClaimer.sub(sednBalanceBeforeClaimer)).to.equal(amount);
    });

    it("should send funds from a wallet to a registered user on chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // Send
      const usdcBeforeSednContract = await usdc.balanceOf(contract.address);
      const usdcBeforeSednSender = await usdc.balanceOf(sender.address);
      const sednBeforeSednClaimerTwo = await contract.balanceOf(claimerTwo.address);
      await usdc.connect(sender).approve(contract.address, amount);
      await contract.connect(sender).sednKnown(amount, claimerTwo.address);
      const usdcAfterSednContract = await usdc.balanceOf(contract.address);
      const usdcAfterSednSender = await usdc.balanceOf(sender.address);
      const sednAfterSednClaimerTwo = await contract.balanceOf(claimerTwo.address);

      expect(usdcAfterSednContract.sub(usdcBeforeSednContract)).to.equal(amount);
      expect(usdcBeforeSednSender.sub(usdcAfterSednSender)).to.equal(amount);
      expect(sednAfterSednClaimerTwo.sub(sednBeforeSednClaimerTwo)).to.equal(amount);
    });
  });
  describe("transfers", () => {
    it("should transfer funds from a sednBalance to an unregistered user on the same chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // fund senders sednBalance
      await usdc.connect(sender).approve(contract.address, amount);
      await contract.connect(sender).sednKnown(amount, sender.address);

      // Send
      const sednBeforeTransferSender = await contract.balanceOf(sender.address);
      const solution = "Hello World!";
      const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
      await contract.connect(sender).transferUnknown(amount, secret);
      const sednAfterTransferSender = await contract.balanceOf(sender.address);
      expect(sednBeforeTransferSender.sub(sednAfterTransferSender)).to.equal(amount);

      // Claim
      const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
      const signedMessage = await trusted.signMessage(BigNumber.from(amount), claimer.address, till, secret);
      const signature = ethers.utils.splitSignature(signedMessage);
      const sednBalanceBeforeClaimer = await contract.balanceOf(claimer.address);
      await contract.connect(claimer).claim(solution, secret, till, signature.v, signature.r, signature.s);
      const sednBalanceAfterClaimer = await contract.balanceOf(claimer.address);
      expect(sednBalanceAfterClaimer.sub(sednBalanceBeforeClaimer)).to.equal(amount);
    });
    it("should transfer funds from a sednBalance to a registered user on the same chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // fund senders sednBalance
      await usdc.connect(sender).approve(contract.address, amount);
      await contract.connect(sender).sednKnown(amount, sender.address);

      // Send
      const sednBeforeTransferSender = await contract.balanceOf(sender.address);
      const sednBeforeTransferClaimer = await contract.balanceOf(claimer.address);
      await contract.connect(sender).transferKnown(amount, claimer.address);
      const sednAfterTransferSender = await contract.balanceOf(sender.address);
      const sednAfterTransferClaimer = await contract.balanceOf(claimer.address);
      expect(sednBeforeTransferSender.sub(sednAfterTransferSender)).to.equal(amount);
      expect(sednAfterTransferClaimer.sub(sednBeforeTransferClaimer)).to.equal(amount);
    });
  });
  describe("withdrawals", () => {
    it("should withdraw funds from a sednBalance to the same chain", async function () {
      const amount = 10 * 10 ** 6;
      await contract.deployed();

      // fund senders sednBalance
      await usdc.connect(sender).approve(contract.address, amount);
      await contract.connect(sender).sednKnown(amount, sender.address);

      // Send
      const sednBeforeWithdrawSender = await contract.balanceOf(sender.address);
      const usdcBeforeWithdrawSender = await usdc.balanceOf(sender.address);
      await contract.connect(sender).withdraw(amount);
      const sednAfterWithdrawSender = await contract.balanceOf(sender.address);
      const usdcAfterWithdrawSender = await usdc.balanceOf(sender.address);
      expect(sednBeforeWithdrawSender.sub(sednAfterWithdrawSender)).to.equal(amount);
      expect(usdcAfterWithdrawSender.sub(usdcBeforeWithdrawSender)).to.equal(amount);
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
});
