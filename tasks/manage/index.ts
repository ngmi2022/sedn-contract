import fs from "fs";
import { ethers, network, run, upgrades } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import path from "path";
import { v4 as uuidv4 } from "uuid";

import { feeData, getAbi, getRpcUrl } from "../../helper/utils";

export interface INetwork {
  network: string;
  testnet: boolean;
  usdcAddress?: string;
  forwarderAddress?: string;
  implementationAddress?: string;
  proxyAddress?: string;
}

export async function deployForwarder(network: string): Promise<string> {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const forwarderAddress = await run("deploy:forwarder", { hre });
  return forwarderAddress;
}

export async function deploySedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress, proxyAddress } = await run("deploy:Sedn", {
    hre,
    upgrades,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function upgradeSedn(network: string, proxyAddress: string, forwarderAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress } = await run("upgrade:Sedn", {
    hre,
    upgrades,
    proxyAddress,
    forwarderAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestnetSedn(
  network: string,
  forwarderAddress: string,
  verifierAddress: string,
  usdcAddress: string,
) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress, proxyAddress } = await run("deploy:testnet", {
    hre,
    upgrades,
    forwarderAddress,
    verifierAddress,
    usdcAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function upgradeTestnetSedn(network: string, proxyAddress: string, forwarderAddress: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const { implementationAddress } = await run("upgrade:testnet", {
    hre,
    upgrades,
    proxyAddress,
    forwarderAddress,
  });
  return { implementationAddress, proxyAddress };
}

export async function deployTestUSDC(network: string, amountToDeploy: number) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  hre.changeNetwork(network);
  const usdcAddress = await run("deploy:usdc", { hre, amountToDeploy });
  return usdcAddress;
}

export async function deploySednWithForwarder(
  network: string,
  usdcAddress: string,
  verifierAddress: string,
  testnet: boolean,
) {
  // deploy forwarder
  const forwarderAddress = await deployForwarder(network);
  let addresses: any = {
    implementationAddress: "",
    proxyAddress: "",
  };
  if (testnet) {
    addresses = await deployTestnetSedn(network, forwarderAddress, verifierAddress, usdcAddress);
  } else {
    addresses = await deploySedn(network, forwarderAddress, verifierAddress, usdcAddress);
  }
  console.log("Sedn deployed to: ", addresses.proxyAddress);
  console.log("Implementation contract deployed to: ", addresses.implementationAddress);
  console.log("Forwarder deployed to: ", forwarderAddress);
  console.log("Process finished");
  return {
    implementationAddress: addresses.implementationAddress,
    proxyAddress: addresses.proxyAddress,
    forwarderAddress,
  };
}

export async function deploySednWithAll(network: string, verifierAddress: string, testnet: boolean) {
  // deploy usdc (typically only for testnet)
  const usdcAddress = await deployTestUSDC(network, 100000000);
  console.log("USDC deployed to: ", usdcAddress);
  // deploy forwarder
  const { implementationAddress, proxyAddress, forwarderAddress } = await deploySednWithForwarder(
    network,
    usdcAddress,
    verifierAddress,
    testnet,
  );
  return { implementationAddress, proxyAddress, forwarderAddress, usdcAddress };
}

function checkMissingNetworks(networks: string[], networksHRE: string[]) {
  const missingNetworks = networks.filter(network => !networksHRE.includes(network));
  if (missingNetworks.length) {
    const errorMessage = `The following networks are not available in config: ${missingNetworks.join(", ")}`;
    throw new Error(errorMessage);
  }
}

function initBuild(networks: INetwork[]) {
  const uid = uuidv4();
  const build: IBuild = {
    uid,
    networks,
    state: "init",
    build: [],
  };
  return build;
}

async function getBuild(uid: string): Promise<IBuild> {
  const filePath = path.join(__dirname, `./logs/${uid}.json`);
  console.log("getting file from: ", filePath);
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    const build = JSON.parse(data) as IBuild;
    return build;
  } catch (error) {
    throw new Error(`Could not find build with uid: ${uid}`);
  }
}

async function getMultiSigs(): Promise<Record<string, string>> {
  const filePath = path.join(__dirname, `./config/multi-sig.json`);
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    const multiSigs = JSON.parse(data) as Record<string, string>;
    return multiSigs;
  } catch (error) {
    throw new Error(`Could not find multi-sig.json`);
  }
}

function saveBuild(build: IBuild) {
  const jsonBuild = JSON.stringify(build);
  const filePath = path.join(__dirname, `./logs/${build.uid}.json`);
  fs.writeFileSync(filePath, jsonBuild, { encoding: "utf8" });
  console.log(`Build saved to: ${filePath}`);
  return;
}

export interface IBuild {
  uid: string;
  networks: INetwork[];
  state: IBuildState;
  build?: INetworkBuilt[];
  upgrade?: IBuildState;
}

export type IBuildState = "init" | "pending" | "success";

// every network needs to be completely built before moving to the next one
// a failure results in a complete rebuild at the network level
export interface INetworkBuilt {
  network: string;
  testnet: boolean;
  usdcAddress: string | undefined;
  forwarderAddress: string | undefined;
  implementationAddress: string | undefined;
  proxyAddress: string | undefined;
  upgraded?: boolean;
}

export async function multiNetworkBuild(networks: INetwork[], verifierAddress: string, buildUid?: string) {
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  const networksArray = networks.map((network: INetwork) => network.network);
  const networksHRE = Object.keys(hre.config.networks);
  checkMissingNetworks(networksArray, networksHRE);

  let build: IBuild;
  if (!buildUid) {
    // init build
    build = initBuild(networks);
    saveBuild(build);
  } else {
    build = (await getBuild(buildUid)) as IBuild;
    build.state = "pending";
    saveBuild(build);
  }
  let networksToDo: string[];
  let networksDone: string[];
  while (build.state !== "success") {
    networksDone = build.build?.map((networkBuilt: INetworkBuilt) => networkBuilt.network) || [];
    networksToDo = networksArray.filter(network => !networksDone.includes(network));
    if (!networksToDo.length) {
      build.state = "success";
      saveBuild(build);
      return;
    }
    const networkToBuild: INetwork | undefined = build.networks.find(network => network.network === networksToDo[0]);
    if (!networkToBuild) {
      throw new Error("network to build not found, this shouldn't happen");
    }
    const networkBuilt = await singleNetworkBuild(networkToBuild, verifierAddress);
    console.log("build:", build.build);
    build.build!.push(networkBuilt!);
    saveBuild(build);
  }
  return build;
}

export async function singleNetworkBuild(networkToBuild: INetwork, verifierAddress: string) {
  const network = networkToBuild.network;
  // init network build
  const subBuild: INetworkBuilt = {
    network,
    testnet: networkToBuild.testnet,
    usdcAddress: networkToBuild.usdcAddress ? networkToBuild.usdcAddress : undefined,
    forwarderAddress: networkToBuild.forwarderAddress ? networkToBuild.forwarderAddress : undefined,
    implementationAddress: networkToBuild.implementationAddress ? networkToBuild.implementationAddress : undefined,
    proxyAddress: networkToBuild.proxyAddress ? networkToBuild.proxyAddress : undefined,
  };
  // deploying usdc
  if (!networkToBuild.usdcAddress && networkToBuild.testnet) {
    try {
      subBuild.usdcAddress = await deployTestUSDC(network, 100000000);
    } catch (error) {
      console.log("error deploying usdc", error);
      throw new Error("error deploying usdc");
    }
  }
  // deploying forwarder
  if (!networkToBuild.forwarderAddress) {
    try {
      subBuild.forwarderAddress = await deployForwarder(network);
    } catch (error) {
      console.log("error deploying forwarder", error);
      throw new Error("error deploying forwarder");
    }
  }
  // deploying sedn
  if (!networkToBuild.implementationAddress && !networkToBuild.proxyAddress) {
    try {
      let addresses: { implementationAddress: any; proxyAddress: any };
      if (networkToBuild.testnet) {
        addresses = await deployTestnetSedn(
          network,
          subBuild.forwarderAddress!,
          verifierAddress,
          subBuild.usdcAddress!,
        );
      } else {
        addresses = await deploySedn(network, subBuild.forwarderAddress!, verifierAddress, subBuild.usdcAddress!);
      }
      subBuild.implementationAddress = addresses.implementationAddress!;
      subBuild.proxyAddress = addresses.proxyAddress!;
      console.log("subBuild successful", subBuild);
      return subBuild;
    } catch (error) {
      console.log("error deploying sedn", error);
      throw new Error("error deploying sedn");
    }
  }
  // upgrading sedn
  if (networkToBuild.implementationAddress && networkToBuild.proxyAddress) {
    try {
      let addresses: { implementationAddress: any; proxyAddress: any };
      if (networkToBuild.testnet) {
        addresses = await upgradeTestnetSedn(network, subBuild.proxyAddress!, subBuild.forwarderAddress!);
      } else {
        addresses = await upgradeSedn(network, subBuild.proxyAddress!, subBuild.forwarderAddress!);
      }
      subBuild.implementationAddress = addresses.implementationAddress!;
      subBuild.proxyAddress = addresses.proxyAddress!;
      console.log("subBuild successful", subBuild);
      return subBuild;
    } catch (error) {
      console.log("error upgrading sedn", error);
      throw new Error("error upgrading sedn");
    }
  }
  if (
    (!networkToBuild.implementationAddress && networkToBuild.proxyAddress) ||
    (networkToBuild.implementationAddress && !networkToBuild.proxyAddress)
  ) {
    throw new Error("implementationAddress and proxyAddress must be defined together");
  }
}

export async function getConfig() {
  const filePath = path.join(__dirname, `./config/config.json`);
  console.log("getting config file from: ", filePath);
  try {
    const data = await fs.promises.readFile(filePath, "utf8");
    const networks = JSON.parse(data) as INetwork[];
    return networks;
  } catch (error) {
    throw new Error(`Could not find config file`);
  }
}

export async function multiNetworkUpgrade(buildUid: string) {
  const build = (await getBuild(buildUid)) as IBuild;
  if (!build.build) {
    throw new Error("No build(s) found in build");
  }
  const networksArray = build.networks.map((network: INetwork) => network.network);
  const hre: HardhatRuntimeEnvironment = require("hardhat");
  const networksHRE = Object.keys(hre.config.networks);
  checkMissingNetworks(networksArray, networksHRE);

  let upgradeBuild: IBuild = JSON.parse(JSON.stringify(build)) as IBuild;
  if (upgradeBuild.upgrade! === "success") {
    console.log("build reset to facilitate new upgrade");
    upgradeBuild.build = upgradeBuild.build!.map(networkBuilt => {
      return { ...networkBuilt, upgraded: false };
    });
    upgradeBuild.upgrade = "init" as IBuildState;
  } else {
    upgradeBuild.upgrade = "init" as IBuildState;
  }
  let networksToDo: string[] | undefined;
  while (upgradeBuild.upgrade !== "success") {
    const filteredNetworks = upgradeBuild.build?.filter(networkBuilt => !networkBuilt.upgraded);
    networksToDo = filteredNetworks?.map(networkBuilt => networkBuilt.network);
    if (!networksToDo || !networksToDo.length) {
      upgradeBuild.upgrade = "success";
      saveBuild(upgradeBuild);
      return;
    }
    const networkToUpgrade: INetworkBuilt | undefined = upgradeBuild.build!.find(
      network => network.network === networksToDo![0],
    );
    if (!networkToUpgrade) {
      throw new Error("network build not found, this shouldn't happen");
    }
    const networkUpgraded = await singleNetworkUpgrade(networkToUpgrade);
    upgradeBuild.build = upgradeBuild.build!.filter(entry => entry.network !== networkUpgraded.network);
    upgradeBuild.build!.push(networkUpgraded!);
    upgradeBuild.upgrade = "pending" as IBuildState;
    saveBuild(upgradeBuild);
  }
}

export async function singleNetworkUpgrade(networkToUpgrade: INetworkBuilt) {
  // check if network is fully defined
  if (
    !networkToUpgrade.network ||
    networkToUpgrade.testnet === undefined ||
    !networkToUpgrade.implementationAddress ||
    !networkToUpgrade.proxyAddress ||
    !networkToUpgrade.forwarderAddress ||
    !networkToUpgrade.usdcAddress
  ) {
    throw new Error("network to upgrade is not fully defined");
  }
  const network = networkToUpgrade.network;
  // init network build
  let subBuild: INetworkBuilt = {
    network,
    testnet: networkToUpgrade.testnet,
    usdcAddress: networkToUpgrade.usdcAddress,
    forwarderAddress: networkToUpgrade.forwarderAddress,
    implementationAddress: networkToUpgrade.implementationAddress,
    proxyAddress: networkToUpgrade.proxyAddress,
  };
  try {
    let addresses: { implementationAddress: any; proxyAddress: any };
    if (networkToUpgrade.testnet) {
      addresses = await upgradeTestnetSedn(network, subBuild.proxyAddress!, subBuild.forwarderAddress!);
    } else {
      addresses = await upgradeSedn(network, subBuild.proxyAddress!, subBuild.forwarderAddress!);
    }
    subBuild.implementationAddress = addresses.implementationAddress!;
    subBuild.proxyAddress = addresses.proxyAddress!;
    subBuild.upgraded = true;
    console.log("subBuild successful");
    return subBuild;
  } catch (error) {
    console.log("error upgrading sedn", error);
    throw new Error("error upgrading sedn");
  }
}

export async function transferOwnershipToMultiSig(buildId: string) {
  const build = (await getBuild(buildId)) as IBuild;
  if (!build.build) {
    throw new Error("No build(s) found in build");
  }
  const multiSigs = await getMultiSigs();
  const networkBuilds = build.build;
  for (const networkBuild of networkBuilds) {
    const multiSig = multiSigs[networkBuild.network];
    if (multiSig) {
      const proxyAddress = networkBuild.proxyAddress;
      const abiAddress = networkBuild.implementationAddress;
      if (!proxyAddress || !abiAddress) {
        throw new Error(`No proxy or abi found for network ${networkBuild.network}`);
      }
      const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(networkBuild.network));
      const signer = ethers.Wallet.fromMnemonic(process.env.mnemonic!);
      signer.connect(provider);
      const abi = [
        {
          inputs: [
            {
              internalType: "address",
              name: "newOwner",
              type: "address",
            },
          ],
          name: "transferOwnership",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
      ];
      const contractInstance = new ethers.Contract(proxyAddress, abi, signer);
      const owner = await contractInstance.owner();
      if (owner.toLowerCase() !== multiSig.toLowerCase()) {
        console.log(`Transferring ownership of proxy ${networkBuild.proxyAddress} to ${multiSig}`);
        const fees = await feeData(networkBuild.network, signer);
        const tx = await contractInstance.transferOwnership(multiSig, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        });
        await tx.wait();
        console.log("Ownership transferred successfully");
      }
    }
  }
}
