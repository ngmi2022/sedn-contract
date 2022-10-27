import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";
import { addresses } from "@socket.tech/ll-core/addresses/index";

import type { Sedn, Sedn__factory } from "../../src/types";

function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const usdcTokenAddressess: any = {
  'hardhat': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'mainnet': '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'rinkeby': '0xeb8f08a975ab53e34d8a0330e0d34de942c95926',
  'polygon-mainnet': '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
  'polygon-mumbai': '0xe6b8a5cf854791412c1f6efc7caf629f5df1c747',
};

task("deploy:Sedn").setAction(async function (taskArguments: TaskArguments, { ethers, run, network }) {
  const signers: SignerWithAddress[] = await ethers.getSigners();
  const registry: string = "registry";
  const ch_id: number = network.config.chainId!;
  const registryAddress: string = (ch_id !== 31337) ? addresses[ch_id][registry] : "0xc30141B657f4216252dc59Af2e7CdB9D8792e1B0"
  const sednFactory: Sedn__factory = (
    await ethers.getContractFactory("Sedn")
  );
  const sedn: Sedn = await sednFactory.connect(signers[0]).deploy(usdcTokenAddressess[network.name], registryAddress);
  await sedn.deployed();
  console.log("Sedn deployed to: ", sedn.address);

  if (network.name !== "hardhat") {
    // Verify contract on Etherscan
    await timeout(60000); // We may have to wait a bit until etherscan can read the contract
    await run("verify:verify", {
      address: sedn.address,
      network: network.name,
      constructorArguments: [usdcTokenAddressess[network.name], registryAddress]
    });
  }
});
