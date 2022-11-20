/* eslint @typescript-eslint/no-var-requires: "off" */
import fetch from "cross-fetch";
import { BigNumber, Contract, Wallet, ethers } from "ethers";

import { FakeSigner } from "../../integration/FakeSigner";
import config from "./../../config.json";
import { GetQuote, GetTx } from "./helper/interfaces";
import { sendMetaTx } from "./helper/signer";
import { SocketApi, getUserRequestDictionary } from "./helper/socket-api";

const fetchConfig = async () => {
  const data = config;
  return data;
  // const data: any = await (await fetch("https://api.github.com/gists/3a4dab1609b9fa3a9e86cb40568cd7d2")).json();
  // return JSON.parse(data.files["sedn.json"].content);
};

// some params & functions to facilitate metaTX testing / testnet
const gasless: boolean = true;
const testnet: boolean = true;
const relayers: any = {
  polygon:
    "https://api.defender.openzeppelin.com/autotasks/507b3f04-18d3-41ab-9484-701a01fc2ffe/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/PjcQDaaG11CYHoJJ1Khcj3",
  arbitrum:
    "https://api.defender.openzeppelin.com/autotasks/8e4e19b7-0103-4552-ab68-3646966ab186/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/Th57r6KwhiVCjTbJmUwBHa",
  "arbitrum-goerli":
    "https://api.defender.openzeppelin.com/autotasks/ce515ed3-d267-4654-8843-e9fe7047c05d/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/NifTewFznuMPfh9t5ehvQ7",
};

// Infura URL
const getRpcUrl = (network: string) => {
  const infuraKey: string = process.env.INFURA_API_KEY as string;
  switch (network) {
    case "mainnet":
      return "https://mainnet.infura.io/v3/" + infuraKey;
    case "polygon":
      return "https://polygon-mainnet.infura.io/v3/" + infuraKey;
    case "arbitrum":
      return "https://arbitrum-mainnet.infura.io/v3/" + infuraKey;
    case "goerli":
      return "https://goerli.infura.io/v3/" + infuraKey;
    case "sepolia":
      return "https://sepolia.infura.io/v3/" + infuraKey;
    case "arbitrum-goerli":
      return "https://arbitrum-goerli.infura.io/v3/" + infuraKey;
    default:
      throw new Error("Network not supported: Infura");
  }
};

// Etherscan data
const explorerData: any = {
  mainnet: {
    url: "https://etherscan.com",
    api: "https://api.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  polygon: {
    url: "https://polygonscan.com",
    api: "https://api.polygonscan.com/api",
    apiKey: process.env.POLYGONSCAN_API_KEY || "",
  },
  arbitrum: {
    url: "https://arbiscan.io",
    api: "https://api.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY || "",
  },
  goerli: {
    url: "https://goerli.etherscan.io",
    api: "https://api-goerli.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  sepolia: {
    url: "https://sepolia.etherscan.io",
    api: "https://api-sepolia.etherscan.io/api",
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  "arbitrum-goerli": {
    url: "https://goerli.arbiscan.io/",
    api: "https://api-goerli.arbiscan.io/api",
    apiKey: process.env.ARBISCAN_API_KEY || "",
  },
};

// getting chain Id ?? do we need this?
const getChainId = (network: string) => {
  switch (network) {
    case "mainnet":
      return "1";
    case "polygon":
      return "137";
    case "arbitrum":
      return "42161";
    case "gnosis":
      return "100";
    case "goerli":
      return "4";
    case "sepolia":
      return "11155111";
    case "arbitrum-goerli":
      return "421613";
    default:
      throw new Error("Network not supported: ChainID");
  }
};

export const feeData = async (network: string, signer: Wallet) => {
  switch (network) {
    case "polygon":
      const fees = await fetch("https://gasstation-mainnet.matic.network/v2").then(response => response.json());
      return {
        maxFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxFee) + "", "gwei"),
        maxPriorityFee: ethers.utils.parseUnits(Math.ceil(fees.fast.maxPriorityFee) + "", "gwei"),
      };
    default:
      const feesData = await signer.provider?.getFeeData();
      return {
        maxFee: feesData.maxFeePerGas,
        maxPriorityFee: feesData.maxPriorityFeePerGas,
      };
  }
};

// standardized method of getting etherscan-based abi's
const getAbi = async (network: string, contract: string) => {
  if (explorerData[network] === undefined) {
    throw new Error("Network not supported: explorerData");
  }
  const apiUrl = explorerData[network].api;
  const apiKey = explorerData[network].apiKey;
  const data: any = await (
    await fetch(`${apiUrl}?module=contract&action=getabi&address=${contract}&apikey=${apiKey}`)
  ).json();
  return JSON.parse(data.result);
};

// no testnets need to be included
const supportedNetworks = ["polygon", "arbitrum"];
// dependent on use case
const networksToTest = testnet ? ["arbitrum-goerli"] : ["polygon"];

const getRandomRecipientNetwork = async (fromNetwork: string) => {
  const networks = supportedNetworks.filter(network => network !== fromNetwork);
  const randomIndex = Math.floor(Math.random() * networks.length);
  return networks[randomIndex];
};

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    let config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const signer = new ethers.Wallet(process.env.SENDER_PK || "", provider);
    const verifier = new ethers.Wallet(process.env.VERIFIER_PK || "", provider);
    const recipient = new ethers.Wallet(process.env.RECIPIENT_PK || "", provider);
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdcOrigin = new ethers.Contract(
      config.usdc[network].contract,
      await getAbi(network, config.usdc[network].abi),
      signer,
    );

    return { sedn, usdcOrigin, signer, verifier, config, recipient };
  }
  networksToTest.forEach(function (network) {
    describe(`Sedn from ${network}`, function () {
      let sedn: Contract;
      let usdcOrigin: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let trusted: FakeSigner;
      let config: any;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdcOrigin = deployed.usdcOrigin;
        signer = deployed.signer;
        config = deployed.config;
        recipient = deployed.recipient;

        trusted = new FakeSigner(deployed.verifier, sedn.address);
        if (trusted.getAddress() !== deployed.config.verifier) {
          const error = new Error(
            `Using the wrong verifier: expected ${deployed.config.verifier} got ${trusted.getAddress()}`,
          );
          console.error(error);
          throw error;
        }
      });
      it("send funds to an unregistered user who claims it on a different chain", async function () {
        const explorerUrl = explorerData[network].url;
        const decimals = await usdcOrigin.decimals();
        const decDivider = parseInt(10 ** decimals + "");
        const amount = parseInt(1 * 10 ** decimals + ""); // 1$ in USDC
        const destinationNetwork = testnet ? network : await getRandomRecipientNetwork(network); // only test on testnet as no bridges possible
        const destinationProvider = new ethers.providers.JsonRpcProvider(getRpcUrl(destinationNetwork));
        const destinationRecipient = new ethers.Wallet(process.env.RECIPIENT_PK || "", destinationProvider);
        const usdcDestination = new ethers.Contract(
          config.usdc[destinationNetwork].contract,
          await getAbi(destinationNetwork, config.usdc[destinationNetwork].abi),
          destinationRecipient,
        );

        console.log(
          `INFO: Sending ${amount / decDivider} USDC from ${signer.address} (${network}) to ${
            destinationRecipient.address
          } (${destinationNetwork})`,
        );

        // /**********************************
        // DERISK BUNGI API STUFFS
        // *************************************/

        // TODO: make this an api call
        // instantiate all variables for exemplary tranfser of 1 USDC (Polygon) to approx. 0.5 USDC (xDAI)
        const fromChainId: number = testnet ? parseInt("137") : parseInt(getChainId(network)); // make sure that testnet does a valid api call
        const fromTokenAddress: string = testnet ? config.usdc.polygon.contract : usdcOrigin.address; // make sure that testnet does a valid api call
        const toChainId: number = testnet ? parseInt(getChainId("arbitrum")) : parseInt(getChainId(destinationNetwork)); // make sure that testnet does a valid api call
        const toTokenAddress: string = testnet ? config.usdc.arbitrum.contract : usdcDestination.address; // make sure that testnet does a valid api call
        const userAddress: string = sedn.address;
        const uniqueRoutesPerBridge: boolean = true;
        const sort: string = "output";
        const singleTxOnly: boolean = true;
        console.log(fromChainId, fromTokenAddress, toChainId, toTokenAddress, userAddress);

        // involke API call
        const api = new SocketApi(process.env.SOCKET_API_KEY || "");
        const result: GetQuote = await api.getQuote(
          fromChainId,
          fromTokenAddress,
          toChainId,
          toTokenAddress,
          amount,
          userAddress,
          uniqueRoutesPerBridge,
          sort,
          destinationRecipient.address,
          singleTxOnly,
        );
        const route = result.result.routes[0]; // take optimal route
        const txResult: GetTx = await api.buildTx(route);
        // create calldata dict
        const userRequestDict = await getUserRequestDictionary(txResult);
        const bridgeImpl = txResult.result.approvalData.allowanceTarget;

        // /**********************************
        // SEND
        // *************************************/

        // SECRET HASHING
        const solution = "admfn"; //admfn
        // const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`INFO: Running with solution '${solution}' and secret '${secret}'`);

        const beforeSend = await usdcOrigin.balanceOf(signer.address);
        console.log(typeof beforeSend);
        console.log(
          `ACCOUNTS: SenderOrigin inital state (${network}:${signer.address}) ${beforeSend.toNumber() / decDivider}`,
        );
        // TODO: how can we get a better value for gas limit here?
        const fees = await feeData(network, signer);
        const approve = await usdcOrigin.approve(sedn.address, amount, {
          maxFeePerGas: fees.maxFee,
          maxPriorityFeePerGas: fees.maxPriorityFee,
        });
        console.log(`TX: Approve tx: ${explorerUrl}/tx/${approve.hash}`);
        await approve.wait();
        console.log("TX: Executed approve");

        // ACTUAL SEDN & DECIDE OF GASLESS OR NOT
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            signer,
            process.env.SENDER_PK || "",
            "sedn",
            [amount, secret],
            relayers[network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Send tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt = await signer.provider.getTransactionReceipt(txHash);
          console.log(`TX: Executed send tx with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          const sednToUnregistered = await sedn.sedn(amount, secret);
          console.log(`TX: Send tx: ${explorerUrl}/tx/${sednToUnregistered.hash}`);
          await sednToUnregistered.wait();
          console.log("TX: executed send tx");
        }
        // check sedn
        const afterSend = await usdcOrigin.balanceOf(signer.address);
        console.log(
          `ACCOUNTS: SenderOrigin state after 'send' transaction (${network}:${signer.address}) ${
            afterSend.toNumber() / decDivider
          }`,
        );

        // --------------------------
        // Claim
        // --------------------------
        const beforeClaim = await usdcDestination.balanceOf(destinationRecipient.address);
        console.log(
          `ACCOUNTS: RecipientDestination balance inital state (${destinationNetwork}:${
            destinationRecipient.address
          }) ${beforeClaim.toNumber() / decDivider}`,
        );

        // Claim
        const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
        const signedMessage = await trusted.signMessage(
          BigNumber.from(amount),
          destinationRecipient.address,
          till,
          secret,
        );
        const signature = ethers.utils.splitSignature(signedMessage);

        // IF GASLESS OR NOT
        if (gasless === true) {
          const response = await sendMetaTx(
            sedn,
            recipient,
            process.env.RECIPIENT_PK || "",
            "bridgeClaim",
            [solution, secret, till, signature.v, signature.r, signature.s, userRequestDict, bridgeImpl],
            relayers[network],
            config.forwarder[network],
          );
          const txHash = JSON.parse(response.result).txHash;
          console.log(`TX: Claim tx: ${explorerUrl}/tx/${txHash}`);
          const txReceipt = await signer.provider.getTransactionReceipt(txHash);
          console.log(`TX: Executed claim with txHash: ${txHash} and blockHash: ${txReceipt.blockHash}`);
        } else {
          const bridgeClaim = await sedn
            .connect(recipient)
            .bridgeClaim(solution, secret, till, signature.v, signature.r, signature.s, userRequestDict, bridgeImpl);
          console.log(`TX: Claim tx: ${explorerUrl}/tx/${bridgeClaim.hash}`);
          await bridgeClaim.wait();
        }
        console.log("TX: Executed claim");
        const afterClaim = await usdcDestination.balanceOf(destinationRecipient.address);
        console.log(
          `ACCOUNTS: RecipientDestination balance after 'claim' (${destinationNetwork}:${
            destinationRecipient.address
          }) ${afterClaim.toNumber() / decDivider}`,
        );
        console.log("INFO: Claimed", afterClaim.sub(beforeClaim).toNumber() / decDivider);
      });
    });
  });
});
