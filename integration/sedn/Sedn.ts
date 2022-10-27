/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { Contract, Wallet, ethers } from "ethers";

const sednContractPolygon = '0xc2c6CA9d430745D7244C57773445bF7f98834Ffa';

describe("Sedn Contract", function () {
  async function getSedn() {  
    const provider = new ethers.providers.JsonRpcProvider("https://polygon-mainnet.infura.io/v3/" + process.env.INFURA_API_KEY);
    const feeData = await provider.getFeeData()
    const signer = new ethers.Wallet(process.env.NEW_PK || '', provider);

    // deploy Sedn
    const polygonapi = require('polygonscan-api').init(process.env.POLYGONSCAN_API_KEY);
    const sednAbiObject = await polygonapi.contract.getabi(sednContractPolygon);
    const sedn = new ethers.Contract(sednContractPolygon, sednAbiObject.result[0].ABI, signer);

    const usdcAbiObject = await polygonapi.contract.getabi('0xDD9185DB084f5C4fFf3b4f70E7bA62123b812226');
    const usdc = new ethers.Contract('0x2791bca1f2de4661ed88a30c99a7a9449aa84174', usdcAbiObject.result[0].ABI, signer);

    return { sedn, usdc, signer, feeData};
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
      console.log('before', beforeSend.toString());
      const approve = await usdc.approve(sedn.address, amount, { gasPrice: feeData.gasPrice });
      await approve.wait();
      console.log('approved');
      const sednToUnregistered = await sedn.sednToUnregistered(amount, secret, nullifier, { gasPrice: feeData.gasPrice });
      await sednToUnregistered.wait();
      console.log('sent');

      const afterSend = await usdc.balanceOf(signer.address);
      console.log('afterSend', afterSend.toString());

      // construct necessary calldata for method execution
      const receiverAddress = signer.address
      const toChainId = 100

      // data construct for middleware, which is not used in this test transaction
      const miWaId = 0 
      const miOpNativeAmt = 0
      const inToken = usdc.address
      const miData = "0x"
      const middlewareRequest = [miWaId, miOpNativeAmt, inToken, miData]

      // data construct for hop bridge, which is used in this test transaction
      const briId = 21
      const briOpNativeAmt = 0
      const briData = "0x00000000000000000000000076b22b8c1079a44f1211d867d68b1eda76a635a70000000000000000000000000000000000000000000000000000000000079bdc00000000000000000000000000000000000000000000000000000000000798e4000000000000000000000000000000000000000000000000000001841a05728c00000000000000000000000000000000000000000000000000000000000798e4000000000000000000000000000000000000000000000000000001841a05728c0000000000000000000000002791bca1f2de4661ed88a30c99a7a9449aa841740000000000000000000000000000000000000000000000000000000000000001"
      const bridgeRequest = [briId, briOpNativeAmt, inToken, briData]

      // create calldata dict
      const userRequestDict: any = {
        'receiverAddress': receiverAddress,
        'toChainId': toChainId,
        'amount': amount,
        'middlewareRequest': middlewareRequest,
        'bridgeRequest': bridgeRequest
      };
      const bridgeImpl = "0xa3f9a7a13055f37479Ebc28E57C005F5c9A31F68"

      // const gasEstimate = await sedn.estimateGas.bridgeClaim("hello", "world", userRequestDict, bridgeImpl, { gasPrice: feeData.gasPrice });
      // console.log('estimate', gasEstimate); 
      const yay = await sedn.bridgeClaim(secret, nullifier, userRequestDict, bridgeImpl, { gasPrice: feeData.gasPrice }) // hop bridge Impl Address
      await yay.wait();
      console.log('claimed');


      const afterClaim = await usdc.balanceOf(signer.address);
      console.log('afterClaim', afterClaim);
    });
  });
});
