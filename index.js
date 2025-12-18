// server.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const crypto = require("crypto");
const admin = require("firebase-admin");
const { abort } = require('process');

const serviceAccount = require("./smart-home-37fee-firebase-adminsdk-fb.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const port = process.env.PORT || 3000;

// Generate tracking ID
function generateTrackingId() {
  const prefix = 'PRCL';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
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
    const idToken = token.split(' ')[1]; // "Bearer <idToken>"
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
};

// MongoDB URI
const uri = process.env.MONGO_URI || 
  "mongodb+srv://smart_home_user:lu36KAH6Olqdbd0j@cluster0.qoielcp.mongodb.net/?appName=Cluster0";

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
    const paymentCollection = db.collection('payment');
    const projectsCollection = db.collection("projects");
    

    console.log("MongoDB collections ready.");

    // Admin verification middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    };

   
    // User routes
 
    app.get('/users', verifyFBToken, async (req, res) => {
      try {
        const searchText = req.query.searchText;
        const query = {};

        if (searchText) {
          query.$or = [
            { displayName: { $regex: searchText, $options: 'i' } },
            { email: { $regex: searchText, $options: 'i' } }
          ];
        }

        const cursor = usersCollection.find(query).sort({ createAt: -1 })
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server Error' });
      }
    });

    app.get('/users/:id', async (req, res) => {});

    app.get('/users/:email/role', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      res.send({ role: user?.role || 'user' });
    });

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.createAt = new Date();

      const userExists = await usersCollection.findOne({ email: user.email });
      if (userExists) return res.send({ message: 'user exist' });

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch('/users/:id/role', verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const roleInfo = req.body;
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role: roleInfo.role } }
      );
      res.send(result);
    });

    app.get("/admin/user-count", async (req, res) => {
  const count = await usersCollection.countDocuments({});
  res.send({ totalUsers: count });
});


// Admin stats route

app.get("/admin/stats", async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalServices = await servicesCollection.countDocuments();
    const totalBookings = await bookingsCollection.countDocuments();

    const payments = await paymentCollection.find().toArray();
    const totalRevenue = payments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0
    );

    res.send({
      totalUsers,
      totalServices,
      totalBookings,
      totalRevenue,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ message: "Failed to load admin stats" });
  }
});


    
    // Payment routes
    
    app.post("/payment", async (req, res) => {
      try {
        const result = await paymentCollection.insertOne(req.body);
        return res.send(result);
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Payment failed" });
      }
    });

    // Stripe Checkout session
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'USD',
              unit_amount: amount,
              product_data: { name: paymentInfo.serviceName }
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        metadata: { serviceId: paymentInfo.serviceId,
          serviceName: paymentInfo.serviceName
         },
        customer_email: paymentInfo.createdByEmail,
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,

      });

      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const transactionId = session.payment_intent;

      const paymentExist = await paymentCollection.findOne({ transactionId });
      if (paymentExist) {
        return res.send({
          message: 'already exists',
          transactionId,
          trackingId: paymentExist.trackingId
        });
      }

      const trackingId = generateTrackingId();
      if (session.payment_status === 'paid') {
        await bookingsCollection.updateOne(
          { _id: new ObjectId(session.metadata.serviceId) },
          { $set: { paymentStatus: 'paid', trackingId } }
        );

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          serviceId: session.metadata.serviceId,
          serviceName: session.metadata.serviceName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId
        };

        const resultPayment = await paymentCollection.insertOne(payment);

        return res.send({
          success: true,
          trackingId,
          transactionId,
          paymentInfo: resultPayment
        });
      }

      res.send({ success: true });
    });

    app.get('/payment', async (req, res) => {
      const email = req.query.email;
      const query = email ? { customerEmail: email } : {};
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

   
    // Services routes
    
    app.get('/services', async (req, res) => {
      try {
        const services = await servicesCollection.find().toArray();
        res.send(services);
      } catch (err) {
        res.status(500).send({ message: 'Error fetching services', error: err });
      }
    });

    app.get('/services/:id', async (req, res) => {
      try {
        const service = await servicesCollection.findOne({ _id: new ObjectId(req.params.id) });
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
      try {
        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: req.body }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Error updating service', error: err });
      }
    });

    app.delete('/services/:id', async (req, res) => {
      try {
        const result = await servicesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Error deleting service', error: err });
      }
    });

    
    // Bookings routes
    
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
        if (existingBooking) return res.status(400).send({ message: "Already booked" });

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

    app.get("/bookings", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const bookings = await bookingsCollection.find().toArray();
        res.send(bookings);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Error fetching bookings", error: err });
      }
    });

    app.get("/bookings/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded_email !== email) return res.status(403).send({ message: "Forbidden access" });

      const bookings = await bookingsCollection.find({ userEmail: email }).toArray();
      res.send(bookings);
    });

    app.get("/booking/:id", async (req, res) => {
      try {
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!booking) return res.status(404).send({ message: "Booking not found" });
        res.send(booking);
      } catch (err) {
        res.status(500).send({ message: "Error fetching booking", error: err });
      }
    });

    app.delete("/bookings/:id", async (req, res) => {
      try {
        const result = await bookingsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error deleting booking", error: err });
      }
    });

    app.patch("/bookings/:id", async (req, res) => {
      try {
        const { status } = req.body;
        if (!status) return res.status(400).send({ message: "Status is required" });

        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status } }
        );
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Error updating booking", error: err });
      }
    });

   
    // Projects (assigned & status update)
    // --------------------
    app.get("/projects/assigned/:email", verifyFBToken, async (req, res) => {
      const email = req.params.email;
      if (req.decoded_email !== email) return res.status(403).send({ message: "Forbidden access" });

      const projects = await projectsCollection.find({ decoratorEmail: email }).toArray();
      res.send(projects);
    });

    app.post("/projects/assign", verifyFBToken, verifyAdmin, async (req, res) => {
      const { serviceName, customerEmail, decoratorEmail, date } = req.body;
      if (!serviceName || !customerEmail || !decoratorEmail || !date) {
        return res.status(400).send({ message: "Missing required fields for assignment" });
      }

      const project = {
        serviceName,
        customerEmail,
        decoratorEmail,
        date: new Date(date),
        status: "pending",
        createdAt: new Date(),
      };

      const result = await projectsCollection.insertOne(project);
      res.send({ success: true, message: "Project assigned successfully", insertedId: result.insertedId });
    });

    app.patch("/projects/:id/status", verifyFBToken, async (req, res) => {
      const { status } = req.body;
      if (!status) return res.status(400).send({ message: "Status is required" });

      const email = req.decoded_email;
      const project = await projectsCollection.findOne({ _id: new ObjectId(req.params.id), decoratorEmail: email });
      if (!project) return res.status(403).send({ message: "Forbidden" });

      await projectsCollection.updateOne({ _id: new ObjectId(req.params.id) }, { $set: { status } });
      res.send({ message: "Status updated successfully" });
    });

    // Test connection
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

// Start server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
