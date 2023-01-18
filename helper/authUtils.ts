import axios from "axios";
import * as admin from "firebase-admin";
import { Auth } from "firebase-admin/lib/auth/auth";
import { UserRecord } from "firebase-admin/lib/auth/user-record";

export const getIdToken = async (user: UserRecord) => {
  const env = process.env;
  const firebaseKey = env[`FIREBASE_KEY_${env.GCLOUD_PROJECT!.replace("-", "_")}`];

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

export const createUser = async (auth: Auth, phoneNumber: string, address: string) => {
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

  return user;
};

export const createUserAndGenerateIdToken = async (auth: Auth, phoneNumber: string, address: string) => {
  const user = await createUser(auth, phoneNumber, address);
  const idToken = await getIdToken(user);
  return idToken;
};
