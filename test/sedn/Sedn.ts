import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import type { Sedn } from "../../src/types/Sedn";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { ethers } from "hardhat";


describe("Sedn Contract", function () {
  async function deploySednFixture() {
    const mockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    const sednFactory = await ethers.getContractFactory("Sedn");
    const [owner, addr1, addr2] = await ethers.getSigners();
    const usdc = await mockUSDCFactory.connect(owner).deploy("USD Coin", "USDC");
    const mintToken = await usdc.mint(owner.address, ethers.utils.parseEther("2048"));
    const sedn = await sednFactory.connect(owner).deploy(usdc.address);

    return { sedn, usdc, owner, addr1, addr2 };
  }
  describe("Switch Creation", function () {
    let sedn: Sedn;
    let owner: SignerWithAddress;
    let usdc: Contract;
    beforeEach(async function () {
      const deployed = await loadFixture(deploySednFixture);
      sedn = deployed.sedn;
      owner = deployed.owner;
      usdc = deployed.usdc;
    });
    it("send funds to an unregistered user", async function () {
      await usdc.approve(sedn.address, 10);
      await sedn.connect(owner).sednToUnregistered(10, "hello", "world");
      expect(await usdc.balanceOf(sedn.address)).to.equal(10);
    });
  });
});
