import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// actual hardhat deploy
task("deploy:testnet").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const verifierAddress = taskArguments.verifierAddress;
  const trustedForwarderAddress = taskArguments.forwarderAddress;
  const usdcAddress = taskArguments.usdcAddress;
  const upgrades = taskArguments.upgrades;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();

  const registryAddress: string = "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0"; // mainnet registry address, could really be anything
  const sednFactory: ContractFactory = await ethers.getContractFactory("SednTestnet");
  const sednArgs = [usdcAddress, registryAddress, verifierAddress, trustedForwarderAddress];
  const proxy = await upgrades.deployProxy(sednFactory, sednArgs, {
    kind: "uups",
    constructorArgs: [trustedForwarderAddress],
  });
  await proxy.deployed();
  const implementationAddress = await getImplementationAddress(signer.provider, proxy.address);
  console.log("Sedn deployed to: ", proxy.address);
  console.log("Sedn implementation deployed to: ", implementationAddress);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: proxy.address,
      constructorArguments: [trustedForwarderAddress],
    });
  }
  return { implementationAddress, proxyAddress: proxy.address };
});
