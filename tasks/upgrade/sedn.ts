import { getImplementationAddress } from "@openzeppelin/upgrades-core";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// actual hardhat deploy
task("upgrade:Sedn").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const proxyAddress = taskArguments.proxyAddress;
  const upgrades = taskArguments.upgrades;
  const forwarderAddress = taskArguments.forwarderAddress;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();

  const sednFactory: ContractFactory = await ethers.getContractFactory("Sedn");
  const upgrade = await upgrades.upgradeProxy(proxyAddress, sednFactory);
  await upgrade.deployed();
  const implementationAddress = await getImplementationAddress(signer.provider, upgrade.address);
  console.log("Upgraded Sedn proxy at: ", upgrade.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: upgrade.address,
      constructorArguments: [forwarderAddress],
    });
  }
  return { proxyAddress: upgrade.address, implementationAddress };
});
