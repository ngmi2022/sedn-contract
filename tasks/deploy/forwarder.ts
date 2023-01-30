import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { SednForwarder, SednForwarder__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:forwarder").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const forwarderFactory: SednForwarder__factory = await ethers.getContractFactory("SednForwarder");
  const forwarder: SednForwarder = await forwarderFactory.connect(signers[0]).deploy();
  console.log(forwarder.deployTransaction.hash);
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
