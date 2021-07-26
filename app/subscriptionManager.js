/*** 
 * 
 * Handles interacting w Stripe and Firebase for subscription management.
 * 
 *   initializeFirebase, signIn to get or create a new anonymous fb account, 
 *   getSub to get the users sub from fb account. subscribe() w product key
 *   and manage via the url from getStripePortalURL.
 * 
 ***/


async function createSubscription(product) {
    // handle monthly or annual subscribe

    FBDB || initializeFirebase();
    if (!FBDB) {
	console.error("Problem initializing Firebase");
	alert("Sorry Firebase initialization failed.");
	return;
    }

    if (!confirm("You will now be forwarded to Stripe to confirm payment details to Data Foundries LLC (BrainTool's incorporated name).\n\nAfter that BT will reload with your premium membership in place and a link to the Stripe portal from which you can manage or cancel your subscription at any time.\n\nNB coupons can be applied at purchase.\nForwarding might take several seconds."))
	return;

    // Create user id, store in localStore and in BTFile text
    BTId = BTId || await signIn();
    if (!BTId) {
	console.error("Error signing in to FB");
	alert("Sorry Firebase user creation failed.");
	return;
    }
    let sub = await getSub();

    // Save sub id as BTId in local storage and org file property
    window.postMessage({'function': 'localStore', 'data': {'BTId': BTId}});
    setMetaProp('BTId', BTId);
    await saveBT();
    if (sub) {
	alert("Seems like you already have a subscription associated with this browser.");
	console.log("Subscription exists for this user:", sub);
	return;
    }
    
    // Create sub - redirects to Stripe, so execution will end here.
    // on reload the BTId value set above will indicate a premium subscription
    subscribe(product);
}

async function openStripePortal() {
    // open page to manage subscription
    if (!BTId) {
	alert('BrainTool Id not set!');
	return;
    }
    const url = await getStripePortalURL();
    window.open(url, '_blank');
}

// https://dashboard.stripe.com/tax-rates
const taxRates = [];

// https://dashboard.stripe.com/apikeys
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// Config values generated by FB app console
var FBKey,  BTId, STRIPE_PUBLISHABLE_KEY;
const firebaseConfig = {
  authDomain: "mybraintool-42.firebaseapp.com",
  projectId: "mybraintool-42",
  storageBucket: "mybraintool-42.appspot.com",
  messagingSenderId: "177084785905",
  appId: "1:177084785905:web:305c20b6239b97b3243550"
};

const Annual = "price_1J0uYvJfoHixgzDGqVnNt5Zg";
const Monthly = "price_1J0uYFJfoHixgzDGiXtFAcdB";

const FunctionLocation = 'us-east1';
let FBDB = null;

function initializeFirebase() {
    // Initialize Firebase w config + key
    if (!FBKey) {
	console.error("Firebase api key not set!");
	return;
    }
    firebaseConfig.apiKey = FBKey;
    const firebaseApp = firebase.initializeApp(firebaseConfig);
    FBDB = firebaseApp.firestore();
}

async function signIn() {
    // return current user if signed in, otherwise return a promise that resolves when
    // a new anonymous user is created
    
    FBDB || initializeFirebase();
    let uid = firebase.auth()?.currentUser?.uid;
    if (uid) return uid;

    return new Promise(function (resolve) {
	firebase.auth().signInAnonymously().then(() => {
	    firebase.auth().onAuthStateChanged((firebaseUser) => {
		if (firebaseUser) resolve(firebaseUser.uid);
	    });
	}).catch((error) => {
	    var errorCode = error.code;
	    var errorMessage = error.message;
	    console.log(errorCode, errorMessage);
	    resolve(null);
	});
    });
}
// NB Signout : firebase.auth().signOut());



function getSub() {
    // Get subscription record for current user

    FBDB || initializeFirebase();
    return new Promise(function (resolve) {
	FBDB.collection('customers')
	    .doc(BTId)
	    .collection('subscriptions')
	    .where('status', 'in', ['trialing', 'active'])
	    .onSnapshot((snapshot) => {
		if (snapshot.empty) {
		    console.log("No active subscriptions!");
		    resolve(null);
		} else {		
		    const subscription = snapshot.docs[0].data();		   // only one
		    //const priceData = (await subscription.price.get()).data();
		    console.log(`Sub: ${subscription}`);
		    resolve(subscription);
		}
	    });
    });
}

// Checkout handler
async function subscribe(productPrice) {
    const selectedPrice = {
	price: productPrice,
	quantity: 1,
    };
    const checkoutSession = {
	collect_shipping_address: false,
	billing_address_collection: 'auto',
	tax_rates: taxRates,
	allow_promotion_codes: true,
	line_items: [selectedPrice],
	success_url: window.location.href,
	cancel_url: window.location.href
    };
    const docRef = await FBDB
	  .collection('customers')
	  .doc(BTId)
	  .collection('checkout_sessions')
	  .add(checkoutSession);
    
    // Wait for the CheckoutSession to get attached by the fb extension
    docRef.onSnapshot((snap) => {
	const { error, sessionId } = snap.data();
	if (error) {
	    alert(`An error occured: ${error.message}`);
	}
	if (sessionId) {
	    // We have a session, let's redirect to Checkout
	    // Init Stripe
	    const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);

	    // before leaving bt grab newly written bt.org file version #
	    updateFileVersion();
	    stripe.redirectToCheckout({ sessionId });
	}
    });
}

async function getStripePortalURL() {
    // Billing portal handler
    let rsp;
    try {
	const functionRef = firebase
	      .app()
	      .functions(FunctionLocation)
	      .httpsCallable('createSimplePortalLink');
	rsp = await functionRef(
	    { returnUrl: "https://braintool.org", 'BTId': BTId });
    } catch(e) {
	console.error("Error in getPortal:", JSON.stringify(e));
	return ("https://braintool.org/support");
    }
    return rsp.data.url;
}
    
