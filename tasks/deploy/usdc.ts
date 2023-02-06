import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import { TestUSDC, TestUSDC__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

task("deploy:usdc").setAction(async function (taskArguments: TaskArguments) {
  // args
  const hre = taskArguments.hre;
  const amountToDeploy = taskArguments.amountToDeploy;

  // ethers setup
  const ethers = hre.ethers;
  const network = hre.network;
  const signer = await ethers.getSigner();
  const testUsdcFactory: TestUSDC__factory = await ethers.getContractFactory("testUSDC");
  const usdc: TestUSDC = await testUsdcFactory.connect(signer).deploy(amountToDeploy);
  await usdc.deployed();
  console.log("TestUSDC deployed to: ", usdc.address);
  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await hre.run("verify:verify", {
      address: usdc.address,
      network: network.name,
      constructorArguments: [amountToDeploy],
    });
  }
  return usdc.address;
});
