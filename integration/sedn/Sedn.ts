/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { Contract, Wallet, ethers } from "ethers";

import { GetQuote, GetTx } from "./helper/interfaces";
import { SocketApi, getUserRequestDictionary } from "./helper/socket-api";

const sednContractPolygon = "0xc2c6CA9d430745D7244C57773445bF7f98834Ffa";

describe("Sedn Contract", function () {
  async function getSedn() {
    const provider = new ethers.providers.JsonRpcProvider(
      "https://polygon-mainnet.infura.io/v3/" + process.env.INFURA_API_KEY,
    );
    const feeData = await provider.getFeeData();
    const signer = new ethers.Wallet(process.env.NEW_PK || "", provider);

    // deploy Sedn
    const polygonapi = require("polygonscan-api").init(process.env.POLYGONSCAN_API_KEY);
    const sednAbiObject = await polygonapi.contract.getabi(sednContractPolygon);
    const sedn = new ethers.Contract(sednContractPolygon, sednAbiObject.result[0].ABI, signer);

    const usdcAbiObject = await polygonapi.contract.getabi("0xDD9185DB084f5C4fFf3b4f70E7bA62123b812226");
    const usdc = new ethers.Contract("0x2791bca1f2de4661ed88a30c99a7a9449aa84174", usdcAbiObject.result[0].ABI, signer);

    return { sedn, usdc, signer, feeData };
  }
  describe("Sedn creation", function () {
    let sedn: Contract;
    let usdc: Contract;
    let signer: Wallet;
    let feeData: any;
    beforeEach(async function () {
      const deployed = await getSedn();
      sedn = deployed.sedn;
      usdc = deployed.usdc;
      signer = deployed.signer;
      feeData = deployed.feeData;
    });
    it("send funds to an unregistered user", async function () {
      const secret = (Math.random() + 1).toString(36).substring(7);
      const nullifier = (Math.random() + 1).toString(36).substring(7);
      console.log(`Running with secret '${secret}' and nullifier '${nullifier}'`);
      const amount = 1000000; // 1 USD

      const beforeSend = await usdc.balanceOf(signer.address);
      console.log("before", beforeSend.toString());
      const approve = await usdc.approve(sedn.address, amount, { gasPrice: feeData.gasPrice });
      await approve.wait();
      console.log("approved");
      const sednToUnregistered = await sedn.sednToUnregistered(amount, secret, nullifier, {
        gasPrice: feeData.gasPrice,
      });
      await sednToUnregistered.wait();
      console.log("sent");

      const afterSend = await usdc.balanceOf(signer.address);
      console.log("afterSend", afterSend.toString());

      // instantiate all variables for exemplary tranfser of 1 USDC (Polygon) to approx. 0.5 USDC (xDAI)
      const fromChainId: number = 137;
      const fromTokenAddress: string = usdc.address;
      const toChainId: number = 100;
      const toTokenAddress: string = "0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83";
      const userAddress: string = "0xc2c6CA9d430745D7244C57773445bF7f98834Ffa";
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
      // const gasEstimate = await sedn.estimateGas.bridgeClaim("hello", "world", userRequestDict, bridgeImpl);
      // console.log("estimate", gasEstimate);
      const yay = await sedn.bridgeClaim(secret, nullifier, userRequestDict, bridgeImpl, {
        gasPrice: feeData.gasPrice,
      }); // hop bridge Impl Address
      await yay.wait();
      console.log("claimed");

      const afterClaim = await usdc.balanceOf(signer.address);
      console.log("afterClaim", afterClaim.toString());
    });
  });
});
