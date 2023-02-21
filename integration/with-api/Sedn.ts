/* eslint @typescript-eslint/no-var-requires: "off" */
import { expect } from "chai";
import { BigNumber, Contract, ethers } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import * as admin from "firebase-admin";
import {
  ChainId,
  ConfigReturnValue,
  Environment,
  IClaimInfoRequest,
  IClaimInfoResp,
  IClaimReq,
  IExecuteTransactionsRequest,
  IExecution,
  ITransaction,
  IWireRequest,
  IWireResponse,
  IWithdrawRequest,
  IWithdrawResponse,
  TransactionType,
} from "sedn-interfaces";

import { FakeSigner } from "../../helper/FakeSigner";
import {
  createUserAndGenerateIdToken,
  deleteAccountsForAnyUIDs,
  deleteExecutionRecordsForAnyPhone,
} from "../../helper/authUtils";
import {
  INetworkScenarios,
  apiCall,
  createFundingScenario,
  fetchConfig,
  generateSecret,
  generateSecretFromSolution,
  getAbi,
  getBalance,
  getChainFromId,
  getChainId,
  getRpcUrl,
  handleTxSignature,
  instantiateFundingScenario,
  sleep,
  timeout,
  waitTillRecipientBalanceChanged,
} from "../../helper/utils";

// /**********************************
// INTERFACES
// *************************************/

export interface ISednVariables {
  sedn: Contract;
  usdcOrigin: Contract;
  signer: ethers.Wallet;
  verifier: ethers.Wallet;
  config: ConfigReturnValue;
  recipient: ethers.Wallet;
  unfundedSigner: ethers.Wallet;
  trusted: FakeSigner;
  decDivider: BigNumber;
  amount: BigNumber;
  relayerWebhook: string;
  forwarderAddress: string;
}

export interface ISednMultichainVariables {
  [key: string]: ISednVariables;
}

// /**********************************
// INTEGRATION PARAMS / ENVIRONMENT VARIABLES
// *************************************/

const TESTNET: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
const deployedNetworks = TESTNET ? ["arbitrum-goerli", "optimism-goerli"] : ["polygon", "arbitrum", "optimism"]; // "optimism", "arbitrum"
let ENVIRONMENT: Environment = (process.env.ENVIRONMENT as Environment) || ("prod" as Environment);
const SIGNER_PK = process.env.SENDER_PK!;
const RECIPIENT_PK = process.env.RECIPIENT_PK!;
const UNFUNDED_SIGNER_PK = process.env.UNFUNDED_SIGNER_PK!;
const VERIFIER_PK = process.env.VERIFIER_PK!;
const AMOUNT_ENV = process.env.AMOUNT || "1";
let NETWORKS = process.env.NETWORKS || deployedNetworks.join(",");
const SINGLE_NETWORK: boolean = process.env.SINGLE_NETWORK === "single" ? true : false;
const networksToTest: string[] = NETWORKS.split(","); // ensure networks to test can be specified in workflow
const API_URLS: any = {
  prod: "https://us-central1-sedn-production.cloudfunctions.net/",
  staging: "https://us-central1-sedn-staging.cloudfunctions.net",
  dev: "http://127.0.0.1:5001/sedn-staging/us-central1",
};
const API_URL = API_URLS[ENVIRONMENT];
console.log("API_URL", API_URL);
ENVIRONMENT = ENVIRONMENT === "dev" ? ("staging" as Environment) : ENVIRONMENT; // ensure that dev is always reverting to staging

// some params & functions to facilitate metaTX testing / testnet
const testnet: boolean = process.env.TESTNET === "testnet" ? true : false; // we need to include this in workflow
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const auth = admin.auth();
const db = admin.firestore();

async function getSedn(network: string): Promise<ISednVariables> {
  let config = await fetchConfig();
  const sednAddress = config.contracts[network].contract;
  const provider = new ethers.providers.JsonRpcProvider(getRpcUrl(network));
  const signer = new ethers.Wallet(SIGNER_PK, provider);
  const verifier = new ethers.Wallet(VERIFIER_PK, provider);
  const recipient = new ethers.Wallet(RECIPIENT_PK, provider);
  const unfundedSigner = new ethers.Wallet(UNFUNDED_SIGNER_PK, provider);
  const relayerWebhook = config.relayerWebhooks[network];
  const forwarderAddress = config.forwarder[network];
  const sedn = new ethers.Contract(sednAddress, await getAbi(network, config.contracts[network].abi), signer);
  console.log("sedn", sedn.address);
  const usdcOrigin = new ethers.Contract(
    config.usdc[network].contract,
    await getAbi(network, config.usdc[network].abi),
    signer,
  );
  const trusted = new FakeSigner(verifier, sedn.address);
  if (trusted.getAddress() !== config.verifier) {
    const error = new Error(`Using the wrong verifier: expected ${config.verifier} got ${trusted.getAddress()}`);
    console.error(error);
    throw error;
  }
  await sleep(1000);
  const decimals = await usdcOrigin.decimals();
  const decDivider = BigNumber.from(10 ** decimals + "");
  const amount = BigNumber.from(AMOUNT_ENV).mul(decDivider);
  return {
    sedn,
    usdcOrigin,
    signer,
    verifier,
    config,
    recipient,
    unfundedSigner,
    trusted,
    decDivider,
    amount,
    relayerWebhook,
    forwarderAddress,
  } as ISednVariables;
}

const wireAndExecute = async (
  senderAddress: string,
  recipientPhone: string,
  amount: string,
  sednVars: ISednMultichainVariables,
  testnet: boolean,
  environment: Environment,
  authToken: string,
): Promise<any> => {
  // build request for API & send request
  const wireRequest: IWireRequest = {
    senderAddress: senderAddress,
    recipientId: recipientPhone,
    amount: amount,
    testnet: testnet,
    environment: environment,
  };
  const wireResponse: IWireResponse = await apiCall(API_URL, "wire", wireRequest, authToken);

  // get approve and signatures
  const transactions: ITransaction[] = wireResponse.transactions;
  const signedTransactions: ITransaction[] = [];
  for (const transaction of transactions) {
    const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
    transaction.signedTx = signedRequest;
    signedTransactions.push(transaction);
  }
  const execution = await execute(signedTransactions, recipientPhone, wireResponse.type, environment, authToken);

  return execution;
};

const claimAndExecute = async (
  recipientAddress: string,
  solution: string,
  sednVars: ISednMultichainVariables,
  testnet: boolean,
  environment: Environment,
  authToken: string,
): Promise<IExecution> => {
  // build claim request and post to claim endpoint
  const claimInfoRequest: IClaimInfoRequest = {
    secret: generateSecretFromSolution(solution),
  };
  const claimInfoResponse: IClaimInfoResp = await apiCall(API_URL, "claimInfo", claimInfoRequest, authToken);
  const claimRequest: IClaimReq = {
    executionIds: claimInfoResponse.executionIds,
    chainIds: claimInfoResponse.chainIds,
    solution,
    recipientAddress,
    testnet,
    environment,
  };
  const claimResponse: IWireResponse = await apiCall(API_URL, "claim", claimRequest, authToken);

  // get signatures
  const claimTransactions: ITransaction[] = claimResponse.transactions;
  const signedClaimTransactions: ITransaction[] = [];
  for (const claimTransaction of claimTransactions) {
    const claimSignedRequest = await handleTxSignature(claimTransaction, sednVars, "recipient");
    claimTransaction.signedTx = claimSignedRequest;
    signedClaimTransactions.push(claimTransaction);
  }

  const claimExecution = await execute(
    signedClaimTransactions,
    recipientAddress,
    claimResponse.type,
    environment,
    authToken,
  );
  return claimExecution;
};

const withdrawAndExecute = async (
  senderAddress: string,
  destinationAddress: string,
  destinationChainId: ChainId,
  amount: string,
  sednVars: ISednMultichainVariables,
  testnet: boolean,
  environment: Environment,
  authToken: string,
  useStargate?: boolean,
): Promise<IExecution> => {
  // build request for withdraw API
  if (!useStargate) useStargate = false;
  const wireRequest: IWithdrawRequest = {
    destinationAddress,
    destinationChainId,
    amount,
    useStargate,
    environment,
    testnet,
  };

  // send request to API
  const withdrawResponse: IWithdrawResponse = await apiCall(API_URL, "withdraw", wireRequest, authToken);

  // get approve and signatures
  const transactions: ITransaction[] = withdrawResponse.transactions;
  const signedTransactions: ITransaction[] = [];
  for (let transaction of transactions) {
    const signedRequest = await handleTxSignature(transaction, sednVars, "unfundedSigner");
    transaction.signedTx = signedRequest;
    signedTransactions.push(transaction);
  }

  const execution = await execute(signedTransactions, destinationAddress, "withdraw", environment, authToken);
  return execution;
};

const execute = async (
  signedTransactions: ITransaction[],
  recipientIdOrAddress: string,
  type: TransactionType,
  environment: Environment,
  authToken: string,
): Promise<IExecution> => {
  // build api request
  const executeTransactionsRequest: IExecuteTransactionsRequest = {
    transactions: signedTransactions,
    environment,
    type,
    recipientIdOrAddress,
  };
  // send signed transactions to API
  const executionResponse = await apiCall(API_URL, "executeTransactions", executeTransactionsRequest, authToken);
  const executionId = executionResponse.execution.id;
  console.log("INFO: executionId", executionId);
  let execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, authToken);
  while (execution.status !== "executed" && execution.status !== "failed") {
    console.log("INFO: not executed retrying for ID", executionId);
    await sleep(10_000);
    execution = await apiCall(API_URL, "executionStatus", { executionId: executionId }, authToken);
  }
  return execution;
};

// /**********************************
// MULTICHAIN INTEGRATION TESTS
// *************************************/

describe(`Sedn testing with api`, function () {
  let sednVars: ISednMultichainVariables;
  let deployed: any;
  const senderPhone = "+4917661597646"; // unfundedSigner
  const knownPhone = "+4917661597645"; // signer
  const claimerPhone = "+4917661597640"; // recipient
  let senderAuthToken: string;
  let knownAuthToken: string;
  let claimerAuthToken: string;
  let accountsToDelete: string[];
  beforeEach(async function () {
    // SEDNVARS
    sednVars = {};
    for (const network of deployedNetworks) {
      deployed = await getSedn(network);
      sednVars[network] = deployed;
    }
    // ACCOUNT AND AUTH MANAGEMENT
    accountsToDelete = [
      senderPhone,
      knownPhone,
      claimerPhone,
      sednVars[networksToTest[0]].unfundedSigner.address,
      sednVars[networksToTest[0]].signer.address,
      sednVars[networksToTest[0]].recipient.address,
    ];
    await deleteAccountsForAnyUIDs(auth, db, accountsToDelete);
    senderAuthToken = await createUserAndGenerateIdToken(
      auth,
      db,
      senderPhone,
      sednVars[networksToTest[0]].unfundedSigner.address,
    );
    knownAuthToken = await createUserAndGenerateIdToken(
      auth,
      db,
      knownPhone,
      sednVars[networksToTest[0]].signer.address,
    );
    // EXECUTION MANAGEMENT
    await deleteExecutionRecordsForAnyPhone(db, claimerPhone);
  });
  it(`should be able to correctly sedn funds to an unknown user`, async function () {
    // partially randomized scenario creation
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from(amount),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0", "mwei"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.5", "mwei"),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0.7", "mwei"),
        sedn: BigNumber.from("0"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // check correct execution of signer side
    const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(usdcBeforeSednSignerSecondNetwork)
      .sub(usdcAfterSednSignerFirstNetwork.add(usdcAfterSednSignerSecondNetwork));
    expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );

    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(auth, db, claimerPhone, claimerAddress);
    const decodedToken = await admin.auth().verifyIdToken(claimerAuthToken);
    console.log("INFO: Claimer UID: ", decodedToken.uid);
    console.log("INFO: Claiming execution with solution: ", solution);
    console.log("INFO: Claiming execution now");
    await claimAndExecute(claimerAddress, solution, sednVars, testnet, ENVIRONMENT, claimerAuthToken);

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].recipient,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      console.log("second network triggered");
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].recipient,
        sednBeforeSednRecipientSecondNetwork,
      );
    }

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly sedn additional payments to an unknown user`, async function () {
    // partially randomized scenario creation
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from(amount).mul(2),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0", "mwei"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("1", "mwei"),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("1.2", "mwei"),
        sedn: BigNumber.from("0"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");
    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );
    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );
    // establish usdc balances of unfundedSigner after execution
    const usdcMidSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcMidSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalMidUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(usdcBeforeSednSignerSecondNetwork)
      .sub(usdcMidSednSignerFirstNetwork.add(usdcMidSednSignerSecondNetwork));
    expect(totalMidUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    const executionTwo = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );
    // establish midway sedn balances of signer
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalUsdcDifferenceSigner = usdcMidSednSignerFirstNetwork
      .add(usdcMidSednSignerSecondNetwork)
      .sub(usdcAfterSednSignerFirstNetwork.add(usdcAfterSednSignerSecondNetwork));
    expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(auth, db, claimerPhone, claimerAddress);
    console.log("INFO: Claiming execution with solution: ", solution);
    console.log("INFO: Claiming execution now");
    await claimAndExecute(claimerAddress, solution, sednVars, testnet, ENVIRONMENT, claimerAuthToken);

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].recipient,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      console.log("second network triggered");
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].recipient,
        sednBeforeSednRecipientSecondNetwork,
      );
    }

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount.mul(2)); // amount is the same for all
    //networks and represents the complete send amounts
  });
  it(`should be able to correctly sedn funds to an known user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from(amount),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0", "mwei"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.5", "mwei"),
        sedn: BigNumber.from("0"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0.7", "mwei"),
        sedn: BigNumber.from("0"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );

    const execution = await wireAndExecute(
      unfundedSignerAddress,
      knownPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );
    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].signer,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].signer,
        sednBeforeSednRecipientSecondNetwork,
      );
    }
    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalUsdcDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(usdcBeforeSednSignerSecondNetwork)
      .sub(usdcAfterSednSignerFirstNetwork.add(usdcAfterSednSignerSecondNetwork));
    expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly transfer funds to an unknown user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from(amount),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("0.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("0.5", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    // establish usdc balances of unfundedSigner after execution
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // check correct execution of signer side
    const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork
      .add(sednBeforeSednSignerSecondNetwork)
      .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
    expect(totalSednDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );

    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(
      auth,
      db,
      claimerPhone,
      sednVars[networksToTest[0]].recipient.address,
    );
    const claimExecution = await claimAndExecute(
      claimerAddress,
      solution,
      sednVars,
      testnet,
      ENVIRONMENT,
      claimerAuthToken,
    );

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].recipient,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].recipient,
        sednBeforeSednRecipientSecondNetwork,
      );
    }
    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly transfer additional payments to an unknown user`, async function () {
    // partially randomized scenario creation
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from(amount).mul(2),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0", "mwei"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("1", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("1.2", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");
    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );
    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );
    // establish usdc balances of unfundedSigner after execution
    const sednMidSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednMidSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalMidSednDifferenceSigner = sednBeforeSednSignerFirstNetwork
      .add(sednBeforeSednSignerSecondNetwork)
      .sub(sednMidSednSignerFirstNetwork.add(sednMidSednSignerSecondNetwork));
    expect(totalMidSednDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    const executionTwo = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );
    // establish midway sedn balances of signer
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalSednDifferenceSigner = sednMidSednSignerFirstNetwork
      .add(sednMidSednSignerSecondNetwork)
      .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
    expect(totalSednDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(auth, db, claimerPhone, claimerAddress);
    console.log("INFO: Claiming execution with solution: ", solution);
    console.log("INFO: Claiming execution now");
    await claimAndExecute(claimerAddress, solution, sednVars, testnet, ENVIRONMENT, claimerAuthToken);

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].recipient,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      console.log("second network triggered");
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].recipient,
        sednBeforeSednRecipientSecondNetwork,
      );
    }

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount.mul(2)); // amount is the same for all
    //networks and represents the complete send amounts
  });
  it(`should be able to correctly transfer funds to an known user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("1", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("0.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("0.5", "mwei"),
      };
    }

    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );

    const execution = await wireAndExecute(
      unfundedSignerAddress,
      knownPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].signer,
      sednBeforeSednRecipientFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].signer,
        sednBeforeSednRecipientSecondNetwork,
      );
    }

    // establish sedn balances of unfundedSigner after execution
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalUsdcDifferenceSigner = sednBeforeSednSignerFirstNetwork
      .add(sednBeforeSednSignerSecondNetwork)
      .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
    expect(totalUsdcDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly sedn and transfer funds to an unknown user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.5", "mwei"),
        sedn: parseUnits("0.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );

    // build request for API
    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish sedn balances of unfundedSigner after execution
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // check correct execution of signer side - usdc + sedn
    const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(
        usdcBeforeSednSignerSecondNetwork.add(sednBeforeSednSignerFirstNetwork).add(sednBeforeSednSignerSecondNetwork),
      )
      .sub(
        usdcAfterSednSignerFirstNetwork
          .add(usdcAfterSednSignerSecondNetwork)
          .add(sednAfterSednSignerFirstNetwork)
          .add(sednAfterSednSignerSecondNetwork),
      );
    expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(
      auth,
      db,
      claimerPhone,
      sednVars[networksToTest[0]].recipient.address,
    );
    const claimExecution = await claimAndExecute(
      claimerAddress,
      solution,
      sednVars,
      testnet,
      ENVIRONMENT,
      claimerAuthToken,
    );

    for (const transaction of claimExecution.transactions) {
      const network = getChainFromId(transaction.chainId);
      console.log("firstNetwork", firstNetwork);
      console.log("secondNetwork", secondNetwork);
      console.log("network", network);
      if (network === firstNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );
      }
      if (network === secondNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].recipient,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
    }
    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly sedn and transfer additional payments to an unknown user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const claimerAddress = sednVars[firstNetwork].recipient.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.50", "mwei"),
        sedn: parseUnits("0.50", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );

    // build request for API
    const execution = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    // establish usdc balances of unfundedSigner after execution
    const usdcMidSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcMidSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish sedn balances of unfundedSigner after execution
    const sednMidSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednMidSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // check correct execution of signer side - usdc + sedn
    const midDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(
        usdcBeforeSednSignerSecondNetwork.add(sednBeforeSednSignerFirstNetwork).add(sednBeforeSednSignerSecondNetwork),
      )
      .sub(
        usdcMidSednSignerFirstNetwork
          .add(usdcMidSednSignerSecondNetwork)
          .add(sednMidSednSignerFirstNetwork)
          .add(sednMidSednSignerSecondNetwork),
      );
    expect(midDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // refund wallet
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish usdc balances of unfundedSigner after execution
    const usdcNewBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcNewBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish sedn balances of unfundedSigner after execution
    const sednNewBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednNewBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // build request for API
    const executionTwo = await wireAndExecute(
      unfundedSignerAddress,
      claimerPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish sedn balances of unfundedSigner after execution
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // check correct execution of signer side - usdc + sedn
    const totalDifferenceSigner = usdcNewBeforeSednSignerFirstNetwork
      .add(
        usdcNewBeforeSednSignerSecondNetwork
          .add(sednNewBeforeSednSignerFirstNetwork)
          .add(sednNewBeforeSednSignerSecondNetwork),
      )
      .sub(
        usdcAfterSednSignerFirstNetwork
          .add(usdcAfterSednSignerSecondNetwork)
          .add(sednAfterSednSignerFirstNetwork)
          .add(sednAfterSednSignerSecondNetwork),
      );
    expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // instantiate claimerUser & get solution
    const solution = execution.transactions[0].solution || "";
    claimerAuthToken = await createUserAndGenerateIdToken(
      auth,
      db,
      claimerPhone,
      sednVars[networksToTest[0]].recipient.address,
    );
    const claimExecution = await claimAndExecute(
      claimerAddress,
      solution,
      sednVars,
      testnet,
      ENVIRONMENT,
      claimerAuthToken,
    );

    for (const transaction of claimExecution.transactions) {
      const network = getChainFromId(transaction.chainId);
      console.log("firstNetwork", firstNetwork);
      console.log("secondNetwork", secondNetwork);
      console.log("network", network);
      if (network === firstNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].recipient,
          sednBeforeSednRecipientFirstNetwork,
        );
      }
      if (network === secondNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].recipient,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
    }
    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].recipient),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].recipient),
    );
    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount.mul(2)); // amount is the same for all
    //networks and represents the complete send amount
  });
  it(`should be able to correctly sedn and transfer funds to an known user`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const amount = sednVars[firstNetwork].amount.toString();
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.5", "mwei"),
        sedn: parseUnits("0.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: parseUnits("0.25", "mwei"),
        sedn: parseUnits("0.25", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednBeforeSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednBeforeSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );

    const execution = await wireAndExecute(
      unfundedSignerAddress,
      knownPhone,
      amount,
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
    );

    for (const transaction of execution.transactions) {
      const network = getChainFromId(transaction.chainId);
      if (network === firstNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[firstNetwork].sedn,
          sednVars[firstNetwork].signer,
          sednBeforeSednRecipientFirstNetwork,
        );
      }
      if (network === secondNetwork) {
        await waitTillRecipientBalanceChanged(
          60_000,
          sednVars[secondNetwork].sedn,
          sednVars[secondNetwork].signer,
          sednBeforeSednRecipientSecondNetwork,
        );
      }
    }

    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish sedn balances of unfundedSigner after execution
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of recipient
    const sednAfterSednRecipientFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].signer),
    );
    const sednAfterSednRecipientSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].signer),
    );

    // check correct execution of signer side - usdc + sedn
    const totalDifferenceSigner = usdcBeforeSednSignerFirstNetwork
      .add(
        usdcBeforeSednSignerSecondNetwork.add(sednBeforeSednSignerFirstNetwork).add(sednBeforeSednSignerSecondNetwork),
      )
      .sub(
        usdcAfterSednSignerFirstNetwork
          .add(usdcAfterSednSignerSecondNetwork)
          .add(sednAfterSednSignerFirstNetwork)
          .add(sednAfterSednSignerSecondNetwork),
      );
    expect(totalDifferenceSigner).to.equal(sednVars[firstNetwork].amount); // amount is the same for all networks and represents the complete send amount

    // check correct execution of recipient side
    const totalSednDifferenceRecipient = sednAfterSednRecipientFirstNetwork
      .add(sednAfterSednRecipientSecondNetwork)
      .sub(sednBeforeSednRecipientFirstNetwork.add(sednBeforeSednRecipientSecondNetwork));
    expect(totalSednDifferenceRecipient).to.equal(sednVars[firstNetwork].amount); // amount is the same for all
    //networks and represents the complete send amount
  });
  it.only(`should be able to correctly withdraw funds`, async function () {
    console.log("INFO: Creating funding scenario");
    const firstNetwork = networksToTest[0];
    const secondNetwork = networksToTest[1];
    const unfundedSignerAddress = sednVars[firstNetwork].unfundedSigner.address;
    const amount = sednVars[firstNetwork].amount;
    const scenarioNetwork: INetworkScenarios = {};
    if (SINGLE_NETWORK) {
      // single network scenario
      scenarioNetwork[firstNetwork] = {
        usdc: parseUnits("0.0", "mwei"),
        sedn: parseUnits("1.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: BigNumber.from("0"),
      };
    } else {
      scenarioNetwork[firstNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("0.5", "mwei"),
      };
      scenarioNetwork[secondNetwork] = {
        usdc: BigNumber.from("0"),
        sedn: parseUnits("1", "mwei"),
      };
    }
    const completeFundingScenario: INetworkScenarios = createFundingScenario(deployedNetworks, scenarioNetwork);
    await instantiateFundingScenario(completeFundingScenario, sednVars);
    console.log("INFO: Done funding");

    // establish previous usdc balances of unfundedSigner
    const usdcBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const usdcBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );

    // establish previous sedn balances of unfundedSigner
    const sednBeforeSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednBeforeSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );

    const execution = await withdrawAndExecute(
      unfundedSignerAddress,
      unfundedSignerAddress,
      parseInt(getChainId(firstNetwork)) as ChainId,
      amount.toString(),
      sednVars,
      testnet,
      ENVIRONMENT,
      senderAuthToken,
      false,
    );
    // build request for withdraw API

    await waitTillRecipientBalanceChanged(
      60_000,
      sednVars[firstNetwork].sedn,
      sednVars[firstNetwork].recipient,
      sednBeforeSednSignerFirstNetwork,
    );
    if (!SINGLE_NETWORK) {
      await waitTillRecipientBalanceChanged(
        60_000,
        sednVars[secondNetwork].sedn,
        sednVars[secondNetwork].recipient,
        sednBeforeSednSignerSecondNetwork,
      );
    }

    // establish usdc balances of unfundedSigner after execution
    const usdcAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].usdcOrigin, sednVars[firstNetwork].unfundedSigner),
    );
    const udscAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].usdcOrigin, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork
      .add(udscAfterSednSignerSecondNetwork)
      .sub(usdcBeforeSednSignerFirstNetwork.add(usdcBeforeSednSignerSecondNetwork));
    const firstNetworkUsdcDifferenceSigner = usdcAfterSednSignerFirstNetwork.sub(usdcBeforeSednSignerFirstNetwork);
    if (testnet === true) {
      expect(totalUsdcDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all networks and represents the complete send amount
    } else {
      expect(totalUsdcDifferenceSigner).to.be.gt(firstNetworkUsdcDifferenceSigner.toNumber()); // should be more than the non-bridged amount
    }

    // establish previous sedn balances of signer
    const sednAfterSednSignerFirstNetwork = BigNumber.from(
      await getBalance(sednVars[firstNetwork].sedn, sednVars[firstNetwork].unfundedSigner),
    );
    const sednAfterSednSignerSecondNetwork = BigNumber.from(
      await getBalance(sednVars[secondNetwork].sedn, sednVars[secondNetwork].unfundedSigner),
    );
    // check correct execution of signer side
    const totalSednDifferenceSigner = sednBeforeSednSignerFirstNetwork
      .add(sednBeforeSednSignerSecondNetwork)
      .sub(sednAfterSednSignerFirstNetwork.add(sednAfterSednSignerSecondNetwork));
    expect(totalSednDifferenceSigner.toString()).to.equal(sednVars[firstNetwork].amount.toString()); // amount is the same for all
    //networks and represents the complete send amount
  });
});
