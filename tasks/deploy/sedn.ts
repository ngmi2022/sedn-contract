import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

import type { Sedn } from "../../src/types/Sedn";
import type { Sedn__factory } from "../../src/types/factories/Sedn__factory";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const usdPriceFeeds: any = {
  'hardhat': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'mainnet': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'rinkeby': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'polygon-mainnet': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
  'polygon-mumbai': '0xd0D5e3DB44DE05E9F294BB0a3bEEaF030DE24Ada',
};

task("deploy:Sedn").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const sednFactory: Sedn__factory = <Sedn__factory>(
    await ethers.getContractFactory("Sedn")
  );
  const sedn: Sedn = <Sedn>await sednFactory.connect(signers[0]).deploy(usdPriceFeeds[network.name]);
  await sedn.deployed();
  console.log("Sedn deployed to: ", sedn.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: sedn.address,
      network: network.name,
      constructorArguments: [usdPriceFeeds[network.name]]
    });
  }
});
