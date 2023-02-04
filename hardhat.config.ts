import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import { config as dotenvConfig } from "dotenv";
import "hardhat-change-network";
import "hardhat-etherscan-abi";
import type { HardhatUserConfig } from "hardhat/config";
import type { NetworkUserConfig } from "hardhat/types";
import { resolve } from "path";

import "./tasks/accounts";
import "./tasks/deploy";

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
  let accounts: any = {
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
      jsonRpcUrl = "https://green-billowing-brook.matic.quiknode.pro/94871d9a244e783d10f5a31aa0d2e19e61ca25d9/";
      break;
    case "polygon-mumbai":
      jsonRpcUrl = "https://powerful-light-brook.matic-testnet.quiknode.pro/6ce1404fa2fdf675ffdeaf2e9036a35a83f2d96a/";
      break;
    case "gnosis":
      jsonRpcUrl = "https://rpc.gnosischain.com";
      break;
    case "arbitrum-mainnet":
      jsonRpcUrl =
        "https://convincing-quaint-lake.arbitrum-mainnet.quiknode.pro/857d08a452034d62d798dafb506880500502adc7/";
      break;
    case "goerli":
      jsonRpcUrl = "https://goerli.infura.io/v3/";
      break;
    case "arbitrum-goerli":
      jsonRpcUrl =
        "https://omniscient-solitary-scion.arbitrum-goerli.quiknode.pro/1c662c045e1a377100a0126ecfca768035478346/";
      break;
    case "optimism":
      jsonRpcUrl = "https://floral-winter-wave.optimism.quiknode.pro/3a10eae6b3a92cec115ab3ecd846d513dc4336d2/";
      break;
    case "optimism-goerli":
      jsonRpcUrl = "https://winter-few-bush.optimism-goerli.quiknode.pro/1fb6db633eccb68892918719fcf6b6f003b112ee/";
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
  defaultNetwork: "hardhat",
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY || "",
      avalanche: process.env.SNOWTRACE_API_KEY || "",
      bsc: process.env.BSCSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
      optimisticEthereum: process.env.OPTIMISM_API_KEY || "",
      optimism: process.env.OPTIMISM_API_KEY || "",
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
