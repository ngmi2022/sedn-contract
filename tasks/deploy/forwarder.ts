import { ethers } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { SednForwarder, SednForwarder__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:forwarder").setAction(async function (taskArguments: TaskArguments) {
  const hre = taskArguments.hre;
  const ethers = hre.ethers;
  const network = hre.network.name;
  const signer = await ethers.getSigner();

  const forwarderFactory: SednForwarder__factory = await ethers.getContractFactory("SednForwarder");
  const forwarder: SednForwarder = await forwarderFactory.connect(signer).deploy();
  console.log(forwarder.deployTransaction.hash);
  await forwarder.deployed();
  console.log("Forwarder deployed to: ", forwarder.address);
  if (network !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: forwarder.address,
      network: network,
      constructorArguments: [],
    });
  }
  return forwarder.address;
});
