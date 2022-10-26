/* eslint @typescript-eslint/no-var-requires: "off" */
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Sedn } from "../../src/types";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers, network } from "hardhat";
import { addresses } from "@socket.tech/ll-core/addresses/index"

describe("Sedn Contract", function () {
  async function deploySednFixture() {
    const sednFactory = await ethers.getContractFactory("Sedn");
    const [owner, addr1, addr2] = await ethers.getSigners();

    // impersonate circle's wallet
    const usdcOwnerAddress = "0x55FE002aefF02F77364de339a1292923A15844B8" // Circle's wallet
    const circleSigner = await ethers.getImpersonatedSigner(usdcOwnerAddress); // Signer for circle's wallet 

    // instantiate etherscan api
    const api = require('etherscan-api').init(process.env.ETHERSCAN_API_KEY);

    // instantiate usdc contract
    const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const usdcAbiAddress = "0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF"
    const usdcAbiObject = await api.contract.getabi(usdcAbiAddress);
    type ObjectKey = keyof typeof usdcAbiObject;
    const result = 'result' as ObjectKey;
    const usdcAbi = usdcAbiObject[result];
    const usdc = new ethers.Contract(usdcAddress, usdcAbi, circleSigner);

    // generate registry address for contract deployment
    const registry: string = "registry";
    const ch_id: number = network.config.chainId!;    
    const registryAddress: string = (ch_id !== 31337) ? addresses[ch_id][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0"

    // deploy Sedn
    const sedn = await sednFactory.connect(owner).deploy(usdc.address, registryAddress);

    return { sedn, usdc, owner, addr1, addr2, circleSigner, registryAddress};
  }
  describe("Sedn creation", function () {
    let sedn: Sedn;
    let owner: SignerWithAddress;
    let usdc: Contract;
    let addr1: SignerWithAddress;
    let circleSigner: SignerWithAddress;
    beforeEach(async function () {
      const deployed = await loadFixture(deploySednFixture);
      sedn = deployed.sedn;
      owner = deployed.owner;
      usdc = deployed.usdc;
      addr1 = deployed.addr1;
      circleSigner = deployed.circleSigner;
    });
    it("send funds to an unregistered user", async function () {
      await usdc.approve(sedn.address, 10);
      const beforeSedn = await usdc.balanceOf(circleSigner.address);
      await sedn.connect(circleSigner).sednToUnregistered(10, "hello", "world");
      const afterSedn = await usdc.balanceOf(circleSigner.address)
      expect(beforeSedn.sub(afterSedn)).to.equal(10);
      expect(await usdc.balanceOf(sedn.address)).to.equal(10);
      const beforeClaim = await usdc.balanceOf(addr1.address);
      await sedn.connect(addr1).claim("hello", "world");
      const afterClaim = await usdc.balanceOf(addr1.address);
      expect(afterClaim.sub(beforeClaim)).to.equal(10);
    });
    it("send funds to registered user", async function () {
      await sedn.connect(owner).setPreferredAddress(addr1.address, "+14157588102");
      await usdc.approve(sedn.address, 10);
      const beforeSend = await usdc.balanceOf(addr1.address)
      await sedn.connect(circleSigner).sednToRegistered(10, "hello", "world", "+14157588102");
      const afterSend = await usdc.balanceOf(addr1.address)
      expect(afterSend.sub(beforeSend)).to.equal(10);
    });
    it("should bridge funds correctly", async function () {
      const amount = 10
      await usdc.approve(sedn.address, amount);
      await sedn.connect(circleSigner).sednToUnregistered(amount, "hello", "world");

      // construct necessary calldata for method execution
      const receiverAddress = owner.address
      const toChainId = 100

      // data construct for middleware, which is not used in this test transaction
      const miWaId = 0 
      const miOpNativeAmt = 0
      const inToken = usdc.address
      const miData = "0x"
      const middlewareRequest = [miWaId, miOpNativeAmt, inToken, miData]

      // data construct for hop bridge, which is used in this test transaction
      const briId = 18
      const briOpNativeAmt = 0
      const briData = "0x0000000000000000000000003666f603cc164936c1b87e207f36beba4ac5f18a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000018413b7dcb40000000000000000000000000000000000000000000000000000000000000001"
      const bridgeRequest = [briId, briOpNativeAmt, inToken, briData]

      // create calldata dict
      const userRequestDict: any = {
        'receiverAddress': receiverAddress,
        'toChainId': toChainId,
        'amount': amount,
        'middlewareRequest': middlewareRequest,
        'bridgeRequest': bridgeRequest
      }
      const beforeClaim = await usdc.balanceOf(sedn.address);
      await sedn.bridgeClaim("hello", "world", userRequestDict, "0x4C9faD010D8be90Aba505c85eacc483dFf9b8Fa9") // hop bridge Impl Address
      const afterClaim = await usdc.balanceOf(sedn.address);
      expect(beforeClaim.sub(afterClaim)).to.equal(10);
    });
  });
});
