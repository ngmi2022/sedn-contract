import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { MinimalForwarder, MinimalForwarder__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:forwarder").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const forwarderFactory: MinimalForwarder__factory = await ethers.getContractFactory("MinimalForwarder");
  const forwarder: MinimalForwarder = await forwarderFactory.connect(signers[0]).deploy();
  await forwarder.deployed();
  console.log("Forwarder deployed to: ", forwarder.address);
  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: forwarder.address,
      network: network.name,
      constructorArguments: [],
    });
  }
});
