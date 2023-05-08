import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-defender";
import "@openzeppelin/hardhat-upgrades";
import { config as dotenvConfig } from "dotenv";
import "hardhat-change-network";
import "hardhat-etherscan-abi";
import type { HardhatUserConfig } from "hardhat/config";
import type { NetworkUserConfig } from "hardhat/types";
import { resolve } from "path";

import "./tasks/deploy";
import "./tasks/upgrade";

dotenvConfig({ path: resolve(__dirname, "./.env") });

// Ensure that we have all the environment variables we need.
const mnemonic: string | undefined = process.env.MNEMONIC;
if (!mnemonic) {
  throw new Error("Please set your MNEMONIC in a .env file");
}

const infuraApiKey: string | undefined = process.env.INFURA_API_KEY;

if (!infuraApiKey) {
  throw new Error("Please set your INFURA_API_KEY in a .env file");
}

const polygonPrivateKey: string | undefined = process.env.POLYGON_PK;

if (!polygonPrivateKey) {
  throw new Error("Please set your POLYGON_PK in a .env file");
}

const chainIds = {
  "arbitrum-mainnet": 42161,
  avalanche: 43114,
  bsc: 56,
  hardhat: 31337,
  mainnet: 1,
  optimism: 10,
  "optimism-goerli": 420,
  "polygon-mainnet": 137,
  "polygon-mumbai": 80001,
  rinkeby: 4,
  goerli: 5,
  gnosis: 100,
  sepolia: 11155111,
  "arbitrum-goerli": 421613,
};

function getChainConfig(chain: keyof typeof chainIds): NetworkUserConfig {
  let jsonRpcUrl: string;
  const accounts: any = {
    count: 50,
    mnemonic,
    path: "m/44'/60'/0'/0",
  };
  switch (chain) {
    case "avalanche":
      jsonRpcUrl = "https://api.avax.network/ext/bc/C/rpc";
      break;
    case "bsc":
      jsonRpcUrl = "https://bsc-dataseed1.binance.org";
      break;
    case "polygon-mainnet":
      jsonRpcUrl = "https://polygon-mainnet.infura.io/v3/" + infuraApiKey;
      break;
    case "polygon-mumbai":
      jsonRpcUrl = "https://polygon-mumbai.infura.io/v3/" + infuraApiKey;
      break;
    case "gnosis":
      jsonRpcUrl = "https://rpc.gnosischain.com";
      break;
    case "arbitrum-mainnet":
      jsonRpcUrl = "https://arbitrum-mainnet.infura.io/v3/" + infuraApiKey;
      break;
    case "goerli":
      jsonRpcUrl = "https://goerli.infura.io/v3/";
      break;
    case "arbitrum-goerli":
      jsonRpcUrl = "https://arbitrum-goerli.infura.io/v3/" + infuraApiKey;
      break;
    case "optimism":
      jsonRpcUrl = "https://optimism-mainnet.infura.io/v3/" + infuraApiKey;
      break;
    case "optimism-goerli":
      jsonRpcUrl = "https://optimism-goerli.infura.io/v3/" + infuraApiKey;
      break;
    default:
      jsonRpcUrl = "https://" + chain + ".infura.io/v3/" + infuraApiKey;
  }
  return {
    accounts: accounts,
    chainId: chainIds[chain],
    url: jsonRpcUrl,
  };
}

const config: HardhatUserConfig = {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //  @ts-ignore
  defender: {
    apiKey: process.env.DEFENDER_TEAM_KEY || "",
    apiSecret: process.env.DEFENDER_TEAM_SECRET || "",
  },
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      rinkeby: process.env.ETHERSCAN_API_KEY || "",
      goerli: process.env.ETHERSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      "arbitrum-goerli": process.env.ARBISCAN_API_KEY || "",
      "optimism-goerli": process.env.OPTIMISM_API_KEY || "",
    },
    customChains: [
      {
        network: "arbitrum-goerli",
        chainId: 421613,
        urls: {
          apiURL: "https://api-goerli.arbiscan.io/api?",
          browserURL: "https://goerli.arbiscan.io/",
        },
      },
      {
        network: "optimism-goerli",
        chainId: 420,
        urls: {
          apiURL: "https://api-goerli-optimistic.etherscan.io/api?",
          browserURL: "https://goerli-optimism.etherscan.io/",
        },
      },
    ],
  },
  gasReporter: {
    currency: "USD",
    enabled: process.env.REPORT_GAS ? true : false,
    excludeContracts: [],
    src: "./contracts",
  },
  networks: {
    hardhat: {
      accounts: {
        mnemonic,
      },
      chainId: chainIds.hardhat,
      forking: {
        enabled: true,
        url: "https://mainnet.infura.io/v3/" + infuraApiKey,
      },
    },
    arbitrum: getChainConfig("arbitrum-mainnet"),
    avalanche: getChainConfig("avalanche"),
    bsc: getChainConfig("bsc"),
    mainnet: getChainConfig("mainnet"),
    optimism: getChainConfig("optimism"),
    "polygon-mainnet": getChainConfig("polygon-mainnet"),
    "polygon-mumbai": getChainConfig("polygon-mumbai"),
    rinkeby: getChainConfig("rinkeby"),
    sepolia: getChainConfig("sepolia"),
    gnosis: getChainConfig("gnosis"),
    goerli: getChainConfig("goerli"),
    "arbitrum-goerli": getChainConfig("arbitrum-goerli"),
    "optimism-goerli": getChainConfig("optimism-goerli"),
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  solidity: {
    version: "0.8.15",
    settings: {
      metadata: {
        // Not including the metadata hash
        // https://github.com/paulrberg/hardhat-template/issues/31
        bytecodeHash: "none",
      },
      // Disable the optimizer when debugging
      // https://hardhat.org/hardhat-network/#solidity-optimizer-support
      optimizer: {
        enabled: true,
        runs: 800,
      },
    },
  },
  typechain: {
    outDir: "src/types",
    target: "ethers-v5",
  },
};

export default config;
