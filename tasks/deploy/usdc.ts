import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ContractFactory } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { SednUSDC, SednUSDC__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:usdc").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const sednUsdcFactory: SednUSDC__factory = await ethers.getContractFactory("SednUSDC");
  const usdc: SednUSDC = await sednUsdcFactory.connect(signers[0]).deploy(10000000);
  console.log(console.log(usdc.deployTransaction.hash));
  await usdc.deployed();
  console.log("sednUSDC deployed to: ", usdc.address);
  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    console.log(network.name);
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: usdc.address,
      network: network.name,
      constructorArguments: [10000000],
    });
  }
});
