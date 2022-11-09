/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { Contract, Wallet, ethers, BigNumber } from "ethers";
import fetch from "cross-fetch";

import { GetQuote, GetTx } from "./helper/interfaces";
import { SocketApi, getUserRequestDictionary } from "./helper/socket-api";

import { FakeSigner } from "../../integration/FakeSigner";
import { verify } from "crypto";

const fetchConfig = async () => {
  const data: any = await (await fetch('https://api.github.com/gists/3a4dab1609b9fa3a9e86cb40568cd7d2')).json()
  return JSON.parse(data.files['sedn.json'].content)
};

describe("Sedn Contract", function () {
  async function getSedn() {
    const config = await fetchConfig();
    const sednContractPolygon = config.contracts.polygon;
    const provider = new ethers.providers.JsonRpcProvider(
      "https://polygon-mainnet.infura.io/v3/" + process.env.INFURA_API_KEY,
    );
    const feeData = await provider.getFeeData();
    const signer = new ethers.Wallet(process.env.NEW_PK || "", provider);
    const verifier = new ethers.Wallet(process.env.VERIFIER_PK || "", provider);

    // deploy Sedn
    const polygonapi = require("polygonscan-api").init(process.env.POLYGONSCAN_API_KEY);
    const sednAbiObject = await polygonapi.contract.getabi(sednContractPolygon);
    const sedn = new ethers.Contract(sednContractPolygon, sednAbiObject.result[0].ABI, signer);

    const usdcAbiObject = await polygonapi.contract.getabi(config.usdc.polygon.abi);
    const usdc = new ethers.Contract(config.usdc.polygon.contract, usdcAbiObject.result[0].ABI, signer);

    return { sedn, usdc, signer, verifier, feeData, config };
  }
  describe("Sedn creation", function () {
    let sedn: Contract;
    let usdc: Contract;
    let signer: Wallet;
    let feeData: any;
    let trusted: FakeSigner;
    let config: any;
    beforeEach(async function () {
      const deployed = await getSedn();
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
      const amount = parseInt(1 * 10 ** 6 + ""); // 1$

      // /**********************************
      // DERISK BUNGI API STUFFS
      // *************************************/


      // TODO: make this an api call
      // instantiate all variables for exemplary tranfser of 1 USDC (Polygon) to approx. 0.5 USDC (xDAI)
      const fromChainId: number = 137;
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

      const solution = (Math.random() + 1).toString(36).substring(7);
      const secret = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(solution));
      console.log(`Running with solution '${solution}' and secret '${secret}'`);

      const beforeSend = await usdc.balanceOf(signer.address);
      console.log("before", beforeSend.toString());
      // TODO: how can we get a better value for gas limit here?
      const approve = await usdc.approve(sedn.address, amount, { gasPrice: feeData.gasPrice, gasLimit: 100000 });
      console.log(`approve tx: https://polygonscan.com/tx/${approve.hash}`);
      await approve.wait();
      console.log("approved");
      const sednToUnregistered = await sedn.sedn(amount, secret, {
        gasPrice: feeData.gasPrice,
        gasLimit: 500000
      });
      console.log(`send tx: https://polygonscan.com/tx/${sednToUnregistered.hash}`);
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
        gasLimit: 500000
      });
      console.log(`claim tx: https://polygonscan.com/tx/${bridgeClaim.hash}`);
      await bridgeClaim.wait();
      console.log("claimed");

      const afterClaim = await usdc.balanceOf(signer.address);
      console.log("afterClaim", afterClaim.toString());
      // expect(beforeClaim.sub(afterClaim)).to.equal(10);
      // TODO: Compare balance with target chain
    });
  });
});
