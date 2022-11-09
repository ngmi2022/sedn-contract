import { ethers } from "hardhat";

async function main() {
    const [deployer] = await ethers.getSigners();
    const chainId = await deployer.getChainId();
    console.log("chainId:", chainId);
    const contract = await ethers.getContractFactory("SednTwo", deployer)
    const nft = await contract.deploy()
    const txn = await nft.deployed()
    console.log("SednTwo deployed to:", nft.address);
    console.log("SednTwo txn:", txn);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });