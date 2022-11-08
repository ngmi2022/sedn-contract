import { expect } from 'chai';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { addresses } from "@socket.tech/ll-core";
import { ethers, network } from "hardhat";
import { it } from "mocha";

import { restoreSnapshot, takeSnapshot } from "../utils/network";
import { FakeSigner } from "./../../integration/FakeSigner";
import { deploySednTwo } from "./../../integration/sednTwo.contract";
import { SednTwo } from "./../../src/types/contracts/SednTwo.sol/SednTwo";

if (!process.env.ETHERSCAN_API_KEY) {
    throw new Error("ETHERSCAN_API_KEY not set");
}

const getRequirements = async () => {
  const usdcOwnerAddress = "0x55FE002aefF02F77364de339a1292923A15844B8"; // Circle's wallet
  const circleSigner = await ethers.getImpersonatedSigner(usdcOwnerAddress); // Signer for circle's wallet

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
  const ch_id: number = network.config.chainId!;
  const registryAddress: string =
    ch_id !== 31337 ? addresses[ch_id][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0";

  return { usdc, registryAddress };
};

describe("SednTwo", function () {
  let snap: number;
  let accounts: SignerWithAddress[];
  let owner: SignerWithAddress;
  let trusted: FakeSigner;
  let contract: SednTwo;
  let usdc: string;
  let registry: string;

  before(async function () {
    accounts = await ethers.getSigners();
    owner = accounts[0];
    const { usdc: usdcAddress, registryAddress } = await getRequirements();
    usdc = usdcAddress.address;
    registry = registryAddress;
    contract = await deploySednTwo([usdc, registryAddress, accounts[1].address], owner);
    trusted = new FakeSigner(accounts[1], contract.address);
  });

  beforeEach(async () => {
    snap = await takeSnapshot();
  });

  afterEach(async () => {
    await restoreSnapshot(snap);
  });

  describe("constructor", () => {
    it("should deploy", async () => {
      const sedn = await deploySednTwo([usdc, registry, accounts[1].address], owner);
      await sedn.deployed();
      expect(await sedn.owner()).to.equal(owner.address);
      expect(await sedn.usdcToken()).to.equal(usdc);
      expect(await sedn.registry()).to.equal(registry);
      expect(await sedn.trustedVerifyAddress()).to.equal(trusted.getAddress());
    });

    it("send funds to an unregistered user", async function () {
      console.log("test");
    });
  });
});
