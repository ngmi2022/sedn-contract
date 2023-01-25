import axios from "axios";
import * as admin from "firebase-admin";
import { Auth } from "firebase-admin/lib/auth/auth";
import { UserRecord } from "firebase-admin/lib/auth/user-record";
import { IAccount, ICreateAccount } from "sedn-interfaces";
import { v4 as uuid } from "uuid";

const COLLECTION_NAME = "accounts";

export const getIdToken = async (user: UserRecord) => {
  const gcloudProject = process.env.GCLOUD_PROJECT;
  let firebaseKey: string = "";
  if (gcloudProject === "sedn-production") {
    firebaseKey = process.env.FIREBASE_KEY_sedn_production || "";
  } else if (gcloudProject === "sedn-staging") {
    firebaseKey = process.env.FIREBASE_KEY_sedn_staging || "";
  }

  let url: string;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${firebaseKey}`;
  } else {
    url = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyCustomToken?key=${firebaseKey}`;
  }
  const customToken = await admin.auth().createCustomToken(user.uid);
  const idTokenResponse = await axios.post(url, {
    token: customToken,
    returnSecureToken: true,
  });
  return idTokenResponse.data.idToken;
};

export const createUser = async (auth: Auth, db: admin.firestore.Firestore, phoneNumber: string, address: string) => {
  let user: UserRecord;
  try {
    user = await auth.getUserByPhoneNumber(phoneNumber);
  } catch (error) {
    if (!error.code || error.code != "auth/user-not-found") {
      throw error;
    }
  }
  // @ts-ignore
  if (!user) {
    user = await auth.createUser({
      phoneNumber: phoneNumber,
      uid: address,
    });
  }

  const hasMasterAccount = await getAccountConnectionRecordsForAnyUID(db, user.uid);
  if (!hasMasterAccount) {
    await createAccountInDatabase(db, {
      phoneUID: user.uid,
      walletUID: user.uid,
    });
  }

  return user;
};

export const createUserAndGenerateIdToken = async (
  auth: Auth,
  db: admin.firestore.Firestore,
  phoneNumber: string,
  address: string,
) => {
  const user = await createUser(auth, db, phoneNumber, address);
  const idToken = await getIdToken(user);
  return idToken;
};

const createAccountInDatabase = async (db: admin.firestore.Firestore, { phoneUID, walletUID }: ICreateAccount) => {
  const uid = uuid();
  let account = {
    master: uid,
  } as IAccount;

  if (phoneUID) {
    account.phoneUID = phoneUID;
  }
  if (walletUID) {
    account.walletUIDs = [walletUID];
  }

  await db.collection(COLLECTION_NAME).doc(uid).set(account);
  const ref = db.collection(COLLECTION_NAME).doc(uid);
  return {
    ref,
    account,
  };
};

const getAccountConnectionRecordsForAnyUID = async (
  db: admin.firestore.Firestore,
  uid: string,
): Promise<IAccount | null> => {
  const doc = await db.collection(COLLECTION_NAME).doc(uid).get();
  if (doc.exists) {
    const data = doc.data() as IAccount;
    return data;
  }

  const walletAccountSnapshot = await db.collection(COLLECTION_NAME).where("walletUIDs", "array-contains", uid).get();

  if (!walletAccountSnapshot.empty) {
    const account = walletAccountSnapshot.docs[0].data() as IAccount;
    return account;
  }

  const phoneAccountSnapshot = await db.collection(COLLECTION_NAME).where("phoneUID", "==", uid).get();

  if (!phoneAccountSnapshot.empty) {
    const account = phoneAccountSnapshot.docs[0].data() as IAccount;
    return account;
  }

  return null;
};

const deleteAccountConnectionRecordsForAnyUID = async (db: admin.firestore.Firestore, uid: string): Promise<void> => {
  const accountData = await getAccountConnectionRecordsForAnyUID(db, uid);
  if (accountData) {
    await db.collection(COLLECTION_NAME).doc(accountData.master).delete();
  }
  return;
};

export const deleteAccountsForAnyUIDs = async (
  auth: Auth,
  db: admin.firestore.Firestore,
  UIDs: string[],
): Promise<void> => {
  for (const uid of UIDs) {
    // ensure there is no account record for this uid
    await deleteAccountConnectionRecordsForAnyUID(db, uid); // this shouldn't throw an error if there is no account record
    // delete auth record
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      //   console.log("INFO: No UID found, trying to delete as a phone UID");
      try {
        const userRecord = await auth.getUserByPhoneNumber(uid); // see if its a phone number UID
        await auth.deleteUser(userRecord.uid);
      } catch (error) {
        // console.log("INFO; No wallet UID found, skipping");
        continue;
      }
    }
  }
  return;
};

export const apiCall = async (apiUrl: string, apiMethod: string, request: any, authToken?: string) => {
  let responseResult: any;
  try {
    const headers: any = { "content-type": "application/json" };
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    console.log(
      `curl -X POST "${apiUrl + "/" + apiMethod}" -d '${JSON.stringify({
        data: request,
      })}' ${Object.keys(headers)
        .map(key => `-H "${key}: ${headers[key]}"`)
        .join(" ")}`,
    );
    const { status, data } = await axios.post(
      `${apiUrl + "/" + apiMethod}/`,
      {
        data: request,
      },
      { headers },
    );
    console.log(`INFO: ${apiMethod} response`);
    console.log("INFO: --  response status", status);
    console.log("INFO: --  response data", JSON.stringify(data));
    responseResult = data.result;
  } catch (e) {
    console.log(e);
    throw e;
  }
  return responseResult;
};
