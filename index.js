// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 3000;
const crypto = require("crypto");
const admin = require("firebase-admin");

const serviceAccount = require("./smart-home-37fee-firebase-adminsdk-fb.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


// Middleware
app.use(cors());
app.use(express.json());

const verifyFBToken = async(req, res, next) =>{
  const token = req.headers.authorization;

  if(!token){
    return res.status(401).send({message: 'unauthorized access'});
  }

  try{
    const idToken = token.split(' ')[1];  // <-- FIXED
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  }
  catch(err){
    return res.status(401).send({message: 'unauthorized access'});
  }
}




// MongoDB URI
const uri = "mongodb+srv://smart_home_user:lu36KAH6Olqdbd0j@cluster0.qoielcp.mongodb.net/?appName=Cluster0";

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

    console.log("MongoDB collections ready.");

    // ==========================
    // USERS ROUTES
    // ==========================
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "User not found" });
      res.send(user);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ message: "User already exists", insertedId: null });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const role = req.body.role;
      const result = await usersCollection.updateOne({ email }, { $set: { role } });
      res.send(result);
    });

    // ==========================
    // SERVICES ROUTES
    // ==========================
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

    // ==========================
    // BOOKINGS ROUTES
    // ==========================
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

    // Get bookings by email (frontend MyBookings)
 app.get("/bookings/:email", verifyFBToken, async (req, res) => {
  try {
    const email = req.params.email; // এখন ঠিক আছে
    const bookings = await bookingsCollection.find({ userEmail: email }).toArray();
    res.send(bookings);
    
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Error fetching bookings", error: err });
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
