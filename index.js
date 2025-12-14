// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const crypto = require("crypto");
const admin = require("firebase-admin");

const serviceAccount = require("./smart-home-37fee-firebase-adminsdk-fb.json");
const { abort } = require('process');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const port = process.env.PORT || 3000;


function generateTrackingId() {
  const prefix = 'PRCL';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase(); // ✅ hex encoding

  return `${prefix}-${date}-${random}`;
}

console.log(generateTrackingId());


// Middleware
app.use(cors());
app.use(express.json());

// Firebase token verification middleware
const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }

  try {
    const idToken = token.split(' ')[1]; // token format: "Bearer <idToken>"
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
};

// MongoDB URI
const uri = process.env.MONGO_URI || "mongodb+srv://smart_home_user:lu36KAH6Olqdbd0j@cluster0.qoielcp.mongodb.net/?appName=Cluster0";

// MongoClient
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db('smart_home_db');

    const usersCollection = db.collection('users');
    const servicesCollection = db.collection('services');
    const bookingsCollection = db.collection('bookings');
   const paymentCollection = db.collection('payment') ;

    console.log("MongoDB collections ready.");

    // must be used after verifyFBToken middleware
    const verifyAdmin = async(req, res, next) =>{
  const email = req.decoded_email;
  const query = {email};
  const user = await  usersCollection.findOne(query);

   if(!user || user.role !== 'admin'){
     return res.status(403).send({message: 'forbidden access'});
   }

      next();
    }

   
   
    // user related pis
  
  app.get('/users', verifyFBToken, verifyFBToken, async (req, res) => {
  try {
    const searchText = req.query.searchText;
    const query = {};

    if (searchText) {
     // query.displayName = { $regex: searchText, $options: 'i' };
     query.$or = [
      { displayName: { $regex: searchText, $options: 'i' } },
        { email: { $regex: searchText, $options: 'i' } }
     ]
    }

    // query 
    const cursor =  usersCollection.find(query).sort({ createAt: -1 }).limit(5);
    const result = await cursor.toArray();
    res.send(result);
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: 'Server Error' });
  }
});



  app.get('/users/:id', async(req, res) =>{

  })

  app.get('/users/:email/role', async(req, res) =>{
   const email = req.params.email;
   const query = {email}
   const user = await usersCollection.findOne(query);
   res.send({role: user?.role || 'user'})
  })

    app.post('/users', async(req, res) =>{
      const user = req.body;
      user.role = 'user';
      user.createAt = new Date();
      const email = user.email;
      const userExists = await usersCollection.findOne({email})

      if(userExists){
        return res.send({message: 'user exist'})
      }



      const result = await usersCollection.insertOne(user);
      res.send(result);

    })

    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async(req, res) =>{
      const id = req.params.id;
      const roleInfo = req.body;
      const query = {_id: new ObjectId(id)}
      const updatedDoc = {
        $set: {
          role: roleInfo.role
        }
      }
      const result = await usersCollection.updateOne(query, updatedDoc) 
      res.send(result);
    })


app.post("/payment", async (req, res) => {
  try {
    const result = await paymentCollection.insertOne(req.body);
    
    // একবার response পাঠানো
    return res.send(result); // return দিলে function শেষ হয়ে যাবে
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Payment failed" });
  }
});



    
   
    // SERVICES ROUTES

    app.get('/services', async (req, res) => {
      try {
        const services = await servicesCollection.find().toArray();
        res.send(services);
      } catch (err) {
        res.status(500).send({ message: 'Error fetching services', error: err });
      }
    });

    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
        if (!service) return res.status(404).send({ message: 'Service not found' });
        res.send(service);
      } catch (err) {
        res.status(500).send({ message: 'Error fetching service', error: err });
      }
    });

    app.post('/services', async (req, res) => {
      const service = req.body;
      const result = await servicesCollection.insertOne(service);
      res.send(result);
    });

    app.patch('/services/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      try {
        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Error updating service', error: err });
      }
    });

    app.delete('/services/:id', async (req, res) => {
      const id = req.params.id;
      try {
        const result = await servicesCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Error deleting service', error: err });
      }
    });

   
    // BOOKINGS ROUTES
    
    app.post("/bookings", async (req, res) => {
      try {
        const { serviceId, userEmail, userName, bookingDate, location } = req.body;

        if (!serviceId || !userEmail || !userName || !bookingDate || !location) {
          return res.status(400).send({ message: "Missing required fields" });
        }

        const service = await servicesCollection.findOne({ _id: new ObjectId(serviceId) });
        if (!service) return res.status(404).send({ message: "Service not found" });

        const existingBooking = await bookingsCollection.findOne({
          serviceId,
          userEmail,
          bookingDate,
        });

        if (existingBooking) {
          return res.status(400).send({ message: "Already booked this service on this date" });
        }

        const booking = {
          serviceId,
          serviceName: service.serviceName || service.name,
          serviceImage: service.image || "",
          cost: service.price || 0,
          unit: service.unit || "",
          userName,
          userEmail,
          bookingDate,
          location,
          status: "pending",
          createdAt: new Date(),
        };

        const result = await bookingsCollection.insertOne(booking);
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error", error: err });
      }
    });

    // Get bookings by email (requires Firebase token)
    app.get("/bookings/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;
        // Optional: check if decoded email matches requested email
        if (req.decoded_email !== email) {
          return res.status(403).send({ message: "Forbidden access" });
        }
        const bookings = await bookingsCollection.find({ userEmail: email }).toArray();
        res.send(bookings);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Error fetching bookings", error: err });
      }
    });

    app.get("/booking/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }
    res.send(booking);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error fetching booking", error: err });
  }
});


    // Delete booking
    app.delete("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Error deleting booking", error: err });
      }
    });

    // Update booking status
    app.patch("/bookings/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;
        if (!status) return res.status(400).send({ message: "Status is required" });

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Error updating booking", error: err });
      }
    });

    // payment related apis
    app.post('/create-checkout-session', async (req,res) =>{
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost)*100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: `please pay for: ${paymentInfo.serviceName}`
              }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: {
          serviceId: paymentInfo.
          serviceId,
          serviceName: paymentInfo.serviceName
        },
        customer_email:paymentInfo.createdByEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      })
      res.send({ url: session.url })
    })
    // old 
    app.post('/create-checkout-session', async (req, res) =>{
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) *100;

       const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data: {
          currency: 'USD',
          unit_amount: amount,
          product_data: {
            name: paymentInfo.serviceName
          }
        },
        quantity: 1,
      },
    ],
    customer_email:paymentInfo.createdByEmail,
    mode: 'payment',
    metadata: {
      
        serviceId: paymentInfo.
      serviceId
    },
    success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success`,
    cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
  });

  console.log(session)
  res.send({ url: session.url })
});

app.patch('/payment-success', async(req, res) =>{
  const sessionId = req.query.session_id;
  
  const session = await stripe.checkout.sessions.retrieve(sessionId);

 // console.log('session retrieve', session)
 const transactionId = session.payment_intent;
 const query = {transactionId: transactionId}

 const paymentExist = await paymentCollection.findOne(query)
console.log(paymentExist);
 if(paymentExist){
   res.send({message: 'already exists', transactionId,
    trackingId:paymentExist.trackingId
   })
 }


   const trackingId = generateTrackingId();
  if(session.payment_status === 'paid'){
    const id = session.metadata.serviceId;
    const query = { _id: new ObjectId(id)}
    const update = {
      $set: {
        paymentStatus: 'paid',
        trackingId: trackingId
      

      }
    }
    const result = await bookingsCollection.updateOne(query, update);

   const payment = {
    amount: session.amount_total/100,
    currency: session.currency,
    customerEmail: session.customer_email,
    serviceId: session.metadata.serviceId,
    serviceName:session.metadata.serviceName,
    transactionId: session.payment_intent,
    paymentStatus:session.payment_status,
    paidAt: new Date(),
    trackingId: trackingId
    
    
}
if(session.payment_status === 'paid'){
 const resultPayment = await paymentCollection.insertOne(payment)

 return res.send({ success: true, 
  modifyParcel:result, 
  trackingId:trackingId,
  transactionId: session.payment_intent,
  paymentInfo: resultPayment })
}

    
  }
  
  res.send({success: true})
})

// payment related apis
app.get('/payment', async(req, res) =>{
  const email = req.query.email;
  const query = {}
  if(email) {
    query.customerEmail = email
  }
  const cursor = paymentCollection.find(query);
  const result = await cursor.toArray();
  res.send(result);
})




    // send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("MongoDB connection successful!");
  } finally {
    // Keep connection alive
  }
}

run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
  res.send('Smart Home API is running!');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
