/* eslint @typescript-eslint/no-var-requires: "off" */
import { Provider } from "@ethersproject/providers";
import { expect } from "chai";
import fetch from "cross-fetch";
import { BigNumber, Contract, Signer, Wallet, ethers } from "ethers";

import { forwarderAddressBook } from "../../gasless/addresses";
import { ForwarderAbi } from "../../gasless/forwarder";
import { signMetaTxRequest } from "../../gasless/signer";
import { FakeSigner } from "../../integration/FakeSigner";
import { GetQuote, GetTx } from "./helper/interfaces";
import { SocketApi, getUserRequestDictionary } from "./helper/socket-api";

const fetchConfig = async () => {
  const data: any = await (await fetch("https://api.github.com/gists/3a4dab1609b9fa3a9e86cb40568cd7d2")).json();
  return JSON.parse(data.files["sedn.json"].content);
};

// some params & functions to facilitate metaTX testing
const workWithMetaTxContracts: boolean = true;
const metaTxContracts: any = {
  contracts: {
    polygon: "0x0Ace214a0b5F38CEd0Dac5105af10e4e661eE496",
    arbitrum: "0x8DC32778b81f7C2A537647CCf7fac2F8BC713f9C",
  },
  testRecipient: {
    polygon: "0x3906d98287847E4Ac8Ee44A87d3fCea531E5692F",
    arbitrum: "0x3906d98287847E4Ac8Ee44A87d3fCea531E5692F",
  },
  usdc: {
    polygon: {
      abi: "0xDD9185DB084f5C4fFf3b4f70E7bA62123b812226",
      contract: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
    },
    arbitrum: {
      abi: "0x1efb3f88bc88f03fd1804a5c53b7141bbef5ded8",
      contract: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    },
  },
  verifier: "0xe0c2eE53925fBe98319ac1f5653677e551E10AD7",
};
const relayers: any = {
  polygon:
    "https://api.defender.openzeppelin.com/autotasks/507b3f04-18d3-41ab-9484-701a01fc2ffe/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/PjcQDaaG11CYHoJJ1Khcj3",
  arbitrum:
    "https://api.defender.openzeppelin.com/autotasks/8e4e19b7-0103-4552-ab68-3646966ab186/runs/webhook/b070ed2b-ef2a-41d4-b249-7945f96640a3/Th57r6KwhiVCjTbJmUwBHa",
};

async function sendMetaTx(
  sednContract: Contract,
  provider: Provider,
  signer: Signer,
  signerKey: string,
  funcName: string,
  funcArgs: any[],
  chainName: string,
) {
  const url: string = relayers[chainName];
  if (!url) throw new Error(`Missing relayer url`);

  const forwarder = new ethers.Contract(forwarderAddressBook[chainName].MinimalForwarder, ForwarderAbi, provider);
  const from = signer.getAddress();
  const data = sednContract.interface.encodeFunctionData(funcName, funcArgs);
  const to = sednContract.address;

  const request = await signMetaTxRequest(signerKey, forwarder, { to, from, data });

  return fetch(url, {
    method: "POST",
    body: JSON.stringify(request),
    headers: { "Content-Type": "application/json" },
  });
}

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
    default:
      throw new Error("Network not supported");
  }
};

const getExplorerUrl = (network: string) => {
  switch (network) {
    case "mainnet":
      return "https://etherscan.com";
    case "polygon":
      return "https://polygonscan.com";
    case "arbitrum":
      return "https://arbiscan.io";
    case "goerli":
      return "https://goerli.etherscan.io";
    default:
      throw new Error("Network not supported");
  }
};

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
    default:
      throw new Error("Network not supported");
  }
};

const getAbi = async (network: string, contract: string) => {
  switch (network) {
    case "mainnet":
      return "https://etherscan.com";
    case "polygon":
      const explorerApi = require("polygonscan-api").init(process.env.POLYGONSCAN_API_KEY);
      const result = await explorerApi.contract.getabi(contract);
      return result.result[0].ABI;
    case "arbitrum":
      const data: any = await (
        await fetch(
          `https://api.arbiscan.io/api?module=contract&action=getabi&address=${contract}&apikey=${process.env.ARBISCAN_API_KEY}`,
        )
      ).json();
      return JSON.parse(data.result);
    default:
      throw new Error("Network not supported");
  }
};

const supportedNetworks = ["polygon", "arbitrum"];

const getRandomRecipientNetwork = async (fromNetwork: string) => {
  const networks = supportedNetworks.filter(network => network !== fromNetwork);
  const randomIndex = Math.floor(Math.random() * networks.length);
  return networks[randomIndex];
};

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    // ensure that correct contracts will be pulled based on testing workWithmMetaTxContracts=true
    let config = await fetchConfig();
    if (workWithMetaTxContracts === true) {
      config = metaTxContracts;
    }
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const feeData = await provider.getFeeData();
    const signer = new ethers.Wallet(process.env.SENDER_PK || "", provider);
    const verifier = new ethers.Wallet(process.env.VERIFIER_PK || "", provider);
    const recipient = new ethers.Wallet(process.env.RECIPIENT_PK || "", provider);
    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdcSenderNetwork = new ethers.Contract(
      config.usdc[network].contract,
      await getAbi(network, config.usdc[network].abi),
      signer,
    );

    return { sedn, usdcSenderNetwork, signer, verifier, feeData, config, recipient };
  }
  [
    "polygon",
    //'arbitrum'
  ].forEach(function (network) {
    describe(`Sedn from ${network}`, function () {
      let sedn: Contract;
      let usdcSenderNetwork: Contract;
      let signer: Wallet;
      let recipient: Wallet;
      let feeData: any;
      let trusted: FakeSigner;
      let config: any;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdcSenderNetwork = deployed.usdcSenderNetwork;
        signer = deployed.signer;
        feeData = deployed.feeData;
        trusted = new FakeSigner(deployed.verifier, sedn.address);
        config = deployed.config;
        recipient = deployed.recipient;

        if (trusted.getAddress() !== deployed.config.verifier) {
          const error = new Error(
            `Using the wrong verifier: expected ${deployed.config.verifier} got  ${trusted.getAddress()}`,
          );
          console.error(error);
          throw error;
        }
      });
      it("send funds to an unregistered user who claims it on a different chain", async function () {
        const explorerUrl = getExplorerUrl(network);
        const decimals = await usdcSenderNetwork.decimals();
        const amount = parseInt(1 * 10 ** decimals + ""); // 1$ in USDC
        const recipientNetwork = await getRandomRecipientNetwork(network);
        const recipientAddress = config.testRecipient[recipientNetwork];
        const usdcRecipientNetwork = new ethers.Contract(
          config.usdc[network].contract,
          await getAbi(network, config.usdc[network].abi),
          signer,
        );
        expect(recipientAddress).to.equal(recipient.address);

        console.log(
          `Sending ${amount / 10 ** decimals}USDC from ${
            signer.address
          } (${network}) to ${recipientAddress} (${recipientNetwork})`,
        );

        // /**********************************
        // DERISK BUNGI API STUFFS
        // *************************************/

        // TODO: make this an api call
        // instantiate all variables for exemplary tranfser of 1 USDC (Polygon) to approx. 0.5 USDC (xDAI)
        const fromChainId: number = parseInt(getChainId(network));
        const fromTokenAddress: string = usdcSenderNetwork.address;
        const toChainId: number = parseInt(getChainId(recipientNetwork));
        const toTokenAddress: string = config.usdc[recipientNetwork].contract;
        const userAddress: string = sedn.address;
        const uniqueRoutesPerBridge: boolean = true;
        const sort: string = "output";
        const singleTxOnly: boolean = true;

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
          recipientAddress,
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

        const getApproveGas = (network: string, gasEstimate: BigNumber) => {
          switch (network) {
            case "arbitrum":
              return { gasLimit: approveGas.mul(2) };
            default:
              return { gasPrice: feeData.gasPrice, gasLimit: approveGas.mul(10) };
          }
        };

        const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`Running with solution '${solution}' and secret '${secret}'`);

        const beforeSend = await usdcSenderNetwork.balanceOf(signer.address);
        // console.log("before", parseInt(beforeSend.toString() + "") / 10 ** decimals);
        // // TODO: how can we get a better value for gas limit here?
        // const approveGas = await usdcSenderNetwork.estimateGas.approve(sedn.address, amount);
        // console.log("approveGas", approveGas.toString());
        // const approve = await usdcSenderNetwork.approve(sedn.address, amount, getApproveGas(network, approveGas));
        // console.log(`approve tx: ${explorerUrl}/tx/${approve.hash}`);
        // await approve.wait();
        // console.log("approved");
        if (workWithMetaTxContracts === true) {
          await sendMetaTx(
            sedn,
            signer.provider,
            signer,
            process.env.SENDER_PK || "",
            "sedn",
            [amount, secret],
            network,
          );
        } else {
          const sednToUnregistered = await sedn.sedn(amount, secret, {
            gasPrice: feeData.gasPrice,
            gasLimit: 1000000,
          });
          console.log(`send tx: ${explorerUrl}/tx/${sednToUnregistered.hash}`);
          await sednToUnregistered.wait();
        }
        console.log("sent");

        const afterSend = await usdcSenderNetwork.balanceOf(signer.address);
        console.log("afterSend", afterSend.toString());

        // --------------------------
        // Claim
        // --------------------------
        const beforeClaim = await usdcRecipientNetwork.balanceOf(recipientAddress);
        console.log(`beforeClaim (${recipientNetwork}:${recipientAddress}) ${beforeClaim.toString()}`);

        // Claim
        const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
        const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipientAddress, till, secret);
        const signature = ethers.utils.splitSignature(signedMessage);
        const bridgeClaim = await sedn
          .connect(recipient)
          .bridgeClaim(solution, secret, till, signature.v, signature.r, signature.s, userRequestDict, bridgeImpl, {
            gasPrice: feeData.gasPrice,
            gasLimit: 5500000,
          });
        console.log(`claim tx: ${explorerUrl}/tx/${bridgeClaim.hash}`);
        await bridgeClaim.wait();
        console.log("claimed");

        const afterClaim = await usdcRecipientNetwork.balanceOf(recipientAddress);
        console.log(`afterClaim (${recipientNetwork}:${recipientAddress}) ${afterClaim.toString()}`);
        console.log("claimed", afterClaim.sub(beforeClaim).toString());
      });
    });
  });
});
