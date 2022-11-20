import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { addresses } from "@socket.tech/ll-core";
import { expect } from "chai";
import { Address } from "defender-relay-client";
import { BigNumber, Contract } from "ethers";
import { ObjectEncodingOptions } from "fs";
import { ethers, network } from "hardhat";
import { it } from "mocha";

import { FakeSigner } from "../../integration/FakeSigner";
import { deploySedn } from "../../integration/sedn.contract";
import { signMetaTxRequest } from "../../integration/sedn/helper/signer";
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

  return { usdc, registryAddress, circleSigner, forwarderAddress, minimalForwarder, relayer };
};

describe("Sedn", function () {
  let snap: number;
  let accounts: SignerWithAddress[];
  let owner: SignerWithAddress;
  let trusted: FakeSigner;
  let contract: Sedn;
  let usdc: Contract;
  let registry: string;
  let circleSigner: SignerWithAddress;
  let claimer: SignerWithAddress;

  before(async function () {
    accounts = await ethers.getSigners();
    owner = accounts[0];
    const requirements = await getRequirements();
    registry = requirements.registryAddress;
    contract = await deploySedn(
      [requirements.usdc.address, requirements.registryAddress, accounts[1].address, requirements.forwarderAddress],
      owner,
    );
    trusted = new FakeSigner(accounts[1], contract.address);
    usdc = requirements.usdc;
    circleSigner = requirements.circleSigner;
    claimer = accounts[2];
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
        [usdc.address, registry, accounts[1].address, requirements.forwarderAddress],
        owner,
      );
      await sedn.deployed();
      expect(await sedn.owner()).to.equal(owner.address);
      expect(await sedn.usdcToken()).to.equal(usdc.address);
      expect(await sedn.registry()).to.equal(registry);
      expect(await sedn.trustedVerifyAddress()).to.equal(trusted.getAddress());
    });

    it("should send funds to an unregistered user on the same chain", async function () {
      const amount = 10;
      await contract.deployed();

      // Send monaye
      await usdc.approve(contract.address, amount);
      const beforeSedn = await usdc.balanceOf(circleSigner.address);
      const solution = "Hello World!";
      const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
      await contract.connect(circleSigner).sedn(amount, secret);
      const afterSedn = await usdc.balanceOf(circleSigner.address);
      expect(beforeSedn.sub(afterSedn)).to.equal(amount);
      expect(await usdc.balanceOf(contract.address)).to.equal(amount);

      // Claim
      const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
      const signedMessage = await trusted.signMessage(BigNumber.from(amount), claimer.address, till, secret);
      const signature = ethers.utils.splitSignature(signedMessage);
      const beforeClaim = await usdc.balanceOf(claimer.address);
      await contract.connect(claimer).claim(solution, secret, till, signature.v, signature.r, signature.s);
      const afterClaim = await usdc.balanceOf(claimer.address);
      expect(afterClaim.sub(beforeClaim)).to.equal(amount);
    });

    it("should send funds to an unregistered user on a different chain", async function () {
      const amount = 10;
      await contract.deployed();

      // Send
      await usdc.approve(contract.address, amount);
      const beforeSedn = await usdc.balanceOf(circleSigner.address);
      const solution = "Hello World!";
      const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
      await contract.connect(circleSigner).sedn(amount, secret);
      const afterSedn = await usdc.balanceOf(circleSigner.address);
      expect(beforeSedn.sub(afterSedn)).to.equal(amount);
      expect(await usdc.balanceOf(contract.address)).to.equal(amount);

      // Claim
      // construct necessary calldata for method execution
      const toChainId = 100;

      // data construct for middleware, which is not used in this test transaction
      const miWaId = 0;
      const miOpNativeAmt = 0;
      const inToken = usdc.address;
      const miData = "0x";
      const middlewareRequest = [miWaId, miOpNativeAmt, inToken, miData];

      // data construct for hop bridge, which is used in this test transaction
      const briId = 18;
      const briOpNativeAmt = 0;
      const briData =
        "0x0000000000000000000000003666f603cc164936c1b87e207f36beba4ac5f18a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000018413b7dcb40000000000000000000000000000000000000000000000000000000000000001";
      const bridgeRequest = [briId, briOpNativeAmt, inToken, briData];

      // create calldata dict
      const userRequestDict: any = {
        receiverAddress: claimer.address,
        toChainId: toChainId,
        amount: amount,
        middlewareRequest: middlewareRequest,
        bridgeRequest: bridgeRequest,
      };

      // Claim
      const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 300;
      const signedMessage = await trusted.signMessage(BigNumber.from(amount), claimer.address, till, secret);
      const signature = ethers.utils.splitSignature(signedMessage);

      const beforeClaim = await usdc.balanceOf(contract.address);
      await contract
        .connect(claimer)
        .bridgeClaim(
          solution,
          secret,
          till,
          signature.v,
          signature.r,
          signature.s,
          userRequestDict,
          "0x4C9faD010D8be90Aba505c85eacc483dFf9b8Fa9",
        );
      const afterClaim = await usdc.balanceOf(contract.address);
      expect(beforeClaim.sub(afterClaim)).to.equal(10);
    });
  });
});
