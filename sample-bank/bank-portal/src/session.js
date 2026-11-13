// The signed-in user and the token the sections use, taken from the ThunderID Vue SDK. A shell component
// calls provideSession() under its ThunderIDProvider; everything below it calls useSession().
import { inject, provide, ref, watch } from 'vue';
import { useThunderID } from '@thunderid/vue';
import { userFrom } from './auth.js';
import { notifyError } from './toasts.js';

const KEY = Symbol('bank-session');

export function provideSession() {
  const { isSignedIn, isLoading, signOut, getAccessToken, getDecodedIdToken } = useThunderID();
  const session = ref(null);
  const user = ref(null);

  // The SDK keeps the tokens; the sections get the access token and who the user is.
  watch(isSignedIn, async (signedIn) => {
    if (!signedIn) {
      session.value = null;
      user.value = null;
      return;
    }
    try {
      const accessToken = await getAccessToken();
      const idClaims = await getDecodedIdToken().catch(() => ({}));
      session.value = { accessToken };
      user.value = userFrom(idClaims, accessToken);
    } catch (err) {
      notifyError('Sign-in failed', err.message);
    }
  }, { immediate: true });

  const state = { isSignedIn, isLoading, signOut, session, user };
  provide(KEY, state);
  return state;
}

export const useSession = () => inject(KEY);
