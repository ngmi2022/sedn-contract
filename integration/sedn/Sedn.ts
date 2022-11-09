/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { Contract, Wallet, ethers, BigNumber } from "ethers";
import fetch from "cross-fetch";

import { GetQuote, GetTx } from "./helper/interfaces";
import { SocketApi, getUserRequestDictionary } from "./helper/socket-api";

import { FakeSigner } from "../../integration/FakeSigner";

const fetchConfig = async () => {
  const data: any = await (await fetch('https://api.github.com/gists/3a4dab1609b9fa3a9e86cb40568cd7d2')).json()
  return JSON.parse(data.files['sedn.json'].content)
};

const getRpcUrl = (network: string) => {
  switch (network) {
    case 'mainnet':
      return 'https://mainnet.infura.io/v3/' + process.env.INFURA_API_KEY;
    case 'polygon':
      return "https://polygon-mainnet.infura.io/v3/" + process.env.INFURA_API_KEY;
    case 'arbitrum':
      return "https://arbitrum-mainnet.infura.io/v3/" + process.env.INFURA_API_KEY;
    default:
      throw new Error('Network not supported');
  }
};

const getExplorerUrl = (network: string) => {
  switch (network) {
    case 'mainnet':
      return 'https://etherscan.com';
    case 'polygon':
      return "https://polygonscan.com";
    case 'arbitrum':
      return "https://arbiscan.io";
    default:
      throw new Error('Network not supported');
  }
};

const getChainId = (network: string) => {
  switch (network) {
    case 'mainnet':
      return '1';
    case 'polygon':
      return "137";
    case 'arbitrum':
      return "42161";
    default:
      throw new Error('Network not supported');
  }
};

const getAbi = async (network: string, contract: string) => {
  switch (network) {
    case 'mainnet':
      return 'https://etherscan.com';
    case 'polygon':
      const explorerApi = require("polygonscan-api").init(process.env.POLYGONSCAN_API_KEY);
      const result = await explorerApi.contract.getabi(contract);
      return result.result[0].ABI;
    case 'arbitrum':
      const data: any = await (await fetch(`https://api.arbiscan.io/api?module=contract&action=getabi&address=${contract}&apikey=${process.env.ARBISCAN_API_KEY}`)).json()
      return JSON.parse(data.result);
    default:
      throw new Error('Network not supported');
  }
};

describe("Sedn Contract", function () {
  async function getSedn(network: string) {
    const config = await fetchConfig();
    const sednContract = config.contracts[network];

    // TODO: support other providers
    const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
    const feeData = await provider.getFeeData();
    const signer = new ethers.Wallet(process.env.NEW_PK || "", provider);
    const verifier = new ethers.Wallet(process.env.VERIFIER_PK || "", provider);

    // Get Sedn
    const sedn = new ethers.Contract(sednContract, await getAbi(network, sednContract), signer);
    const usdc = new ethers.Contract(config.usdc[network].contract, await getAbi(network, config.usdc[network].abi), signer);

    return { sedn, usdc, signer, verifier, feeData, config };
  }
  [
    'polygon',
    'arbitrum'
  ].forEach(function (network) {
    describe(`Sedn from ${network}`, function () {
      let sedn: Contract;
      let usdc: Contract;
      let signer: Wallet;
      let feeData: any;
      let trusted: FakeSigner;
      let config: any;
      beforeEach(async function () {
        const deployed = await getSedn(network);
        sedn = deployed.sedn;
        usdc = deployed.usdc;
        signer = deployed.signer;
        feeData = deployed.feeData;
        trusted = new FakeSigner(deployed.verifier, sedn.address);
        config = deployed.config;

        if (trusted.getAddress() !== deployed.config.verifier) {
          const error = new Error(`Using the wrong verifier: expected ${deployed.config.verifier} got  ${trusted.getAddress()}`);
          console.error(error);
          throw error;
        }
      });
      it("send funds to an unregistered user", async function () {
        const explorerUrl = getExplorerUrl(network);
        const amount = parseInt(1 * 10 ** 6 + ""); // 1$ in USDC

        // /**********************************
        // DERISK BUNGI API STUFFS
        // *************************************/


        // TODO: make this an api call
        // instantiate all variables for exemplary tranfser of 1 USDC (Polygon) to approx. 0.5 USDC (xDAI)
        const fromChainId: number = parseInt(getChainId(network));
        const fromTokenAddress: string = usdc.address;
        const toChainId: number = 100;
        const toTokenAddress: string = config.usdc.gnosis.contract;
        const userAddress: string = sedn.address;
        const uniqueRoutesPerBridge: boolean = true;
        const sort: string = "output";
        const recipient: string = signer.address;
        const singleTxOnly: boolean = true;

        // involke API call
        const apiKey: any = process.env.SOCKET_API_KEY;
        const api = new SocketApi(apiKey);
        const result: GetQuote = await api.getQuote(
          fromChainId,
          fromTokenAddress,
          toChainId,
          toTokenAddress,
          amount,
          userAddress,
          uniqueRoutesPerBridge,
          sort,
          recipient,
          singleTxOnly,
        );
        const route = result.result.routes[0]; // take optimal route
        console.log("api: route found");
        const txResult: GetTx = await api.buildTx(route);
        // create calldata dict
        const userRequestDict = await getUserRequestDictionary(txResult);
        const bridgeImpl = txResult.result.approvalData.allowanceTarget;
        console.log("api: user dictionary retrieved");

        // /**********************************
        // SEND
        // *************************************/

        const getApproveGas = (network: string, gasEstimate: BigNumber) => {
          switch (network) {
            case 'arbitrum':
              return { gasLimit: approveGas.mul(2) };
            default:
              return { gasPrice: feeData.gasPrice, gasLimit: approveGas.mul(4) };
          }
        };

        const solution = (Math.random() + 1).toString(36).substring(7);
        const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
        console.log(`Running with solution '${solution}' and secret '${secret}'`);

        const beforeSend = await usdc.balanceOf(signer.address);
        console.log("before", beforeSend.toString());
        // TODO: how can we get a better value for gas limit here?
        const approveGas = await usdc.estimateGas.approve(sedn.address, amount);
        console.log('approveGas', approveGas.toString());
        const approve = await usdc.approve(sedn.address, amount, getApproveGas(network, approveGas));
        console.log(`approve tx: ${explorerUrl}/tx/${approve.hash}`);
        await approve.wait();
        console.log("approved");
        const sednToUnregistered = await sedn.sedn(amount, secret, {
          gasPrice: feeData.gasPrice,
          gasLimit: 1000000
        });
        console.log(`send tx: ${explorerUrl}/tx/${sednToUnregistered.hash}`);
        await sednToUnregistered.wait();
        console.log("sent");

        const afterSend = await usdc.balanceOf(signer.address);
        console.log("afterSend", afterSend.toString());

        // --------------------------
        // Claim
        // --------------------------

        
        // TODO: does this make sense
        const claimer = signer;

        const beforeClaim = await usdc.balanceOf(signer.address);
        console.log("beforeClaim", beforeClaim.toString());
        
        // Claim
        const till = parseInt(new Date().getTime().toString().slice(0, 10)) + 1000;
        const signedMessage = await trusted.signMessage(BigNumber.from(amount), recipient, till, secret);
        const signature = ethers.utils.splitSignature(signedMessage);
        const bridgeClaim = await sedn.bridgeClaim(solution, secret, till, signature.v, signature.r, signature.s, userRequestDict, bridgeImpl, {
          gasPrice: feeData.gasPrice,
          gasLimit: 5500000
        });
        console.log(`claim tx: ${explorerUrl}/tx/${bridgeClaim.hash}`);
        await bridgeClaim.wait();
        console.log("claimed");

        const afterClaim = await usdc.balanceOf(signer.address);
        console.log("afterClaim", afterClaim.toString());
      });
    });
  });
});
