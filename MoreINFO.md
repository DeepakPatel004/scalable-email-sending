# 📚 Scalable Email Sending Queue System (Redis + BullMQ)
> A comprehensive guide for system architecture, implementation details, and Redis-backed message queue internals.

---

## 📌 Section 1: Core Concepts & Architecture

### 1.1 Producer (Queue) vs. Consumer (Worker)
In a scalable backend, heavy tasks (like email sending, video processing, or PDF generation) are offloaded from the main API thread to a background worker using a message queue.

* **Queue (Producer)**: Responsible for **adding jobs** to the queue in Redis. It does not run the job; it only writes the payload and configuration metadata.
* **Worker (Consumer)**: A background process that continuously polls Redis, **fetches jobs**, executes the heavy tasks, and updates their status.

```text
                        ┌───────────────────┐
                        │      Client       │
                        └─────────┬─────────┘
                                  │ (HTTP POST Request)
                                  ▼
                        ┌───────────────────┐
                        │  Express API Web  │ (Producer)
                        │      Server       │
                        └─────────┬─────────┘
                                  │ queue.add("email", data)
                                  ▼
┌──────────────────────────────────────────────────────────────┐
│                        Redis Database                        │
│                                                              │
│  [Wait Queue] ──► [Active Queue] ──► [Completed / Failed]   │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               │ Worker fetches next job
                               ▼
                        ┌───────────────────┐
                        │  Worker Process   │ (Consumer)
                        └─────────┬─────────┘
                                  │ executes transporter.sendMail()
                                  ▼
                        ┌───────────────────┐
                        │    User Email     │
                        └───────────────────┘
```

### 1.2 Separation of Concerns
* **No Direct Communication**: The Producer (API server) and Consumer (Worker) do **not** communicate directly. They communicate exclusively by reading and writing to **Redis**.
* **Process Separation**: In production, the Producer and Consumer usually run as **different Node.js processes** (e.g., `node server.js` and `node worker.js`). They do not share memory.
* **The Queue Name**: The string namespace (e.g., `"NotificationQueue"`) is the shared identity in Redis. Both the queue and worker must use the exact same string to access the same jobs.

---

## 📌 Section 2: Implementation & Setup Guide

### 2.1 Project Structure
```text
project/
│
├── redis.js       # Shared Redis connection using ioredis
├── queue.js       # Queue instance exports (Producer side)
├── worker.js      # Worker job consumption logic (Consumer side)
├── mailer.js      # Nodemailer configuration
├── server.js      # Express API server receiving requests
├── .env           # Environment variables (credentials)
└── package.json   # Package metadata & dependencies
```

### 2.2 Installation
```bash
npm install express bullmq ioredis nodemailer dotenv
```

---

### 2.3 Core Code Components

#### 🔌 Step 1: Redis Connection Pool (`redis.js`)
Configures a shared connection using `ioredis`.
```javascript
import IORedis from 'ioredis';

const connection = new IORedis({
    host: "127.0.0.1",
    port: 6379,
    maxRetriesPerRequest: null // CRITICAL: Required by BullMQ to process blocking pop actions safely
});

export default connection;
```
> [!WARNING]
> Always set `maxRetriesPerRequest: null` for Redis connections passed to BullMQ. Otherwise, BullMQ workers may crash during network reconnections.

#### 📥 Step 2: Queue Definition (`queue.js`)
Initializes the Queue instance which creates the Redis keyspace structures.
```javascript
import { Queue } from "bullmq";
import connection from "./redis.js";

const NotificationQueue = new Queue("NotificationQueue", { connection });

export default NotificationQueue;
```

#### ⚙️ Step 3: Worker Job Consumer (`worker.js`)
Listens to the same Redis keyspace and runs logic based on the job name.
```javascript
import { Worker } from 'bullmq';
import connection from './redis.js';
import transporter from './mailer.js';

const worker = new Worker(
    "NotificationQueue",
    async (job) => {
        console.log(`Starting job: ${job.name} (ID: ${job.id})`);
        
        switch (job.name) {
            case 'email':
                await transporter.sendMail({
                    from: process.env.EMAIL,
                    to: job.data.email,
                    subject: 'Welcome',
                    text: `Hello ${job.data.name}, welcome onboard!`
                });
                console.log(`Email sent successfully to ${job.data.email}`);
                break;
            default:
                console.log(`No handler configured for job: ${job.name}`);
        }
    },
    { connection }
);
```

#### 🌐 Step 4: Express API Producer (`server.js`)
Exposes an endpoint and adds jobs to the queue.
```javascript
import 'dotenv/config';
import express from 'express';
import NotificationQueue from './queue.js';

const app = express();
app.use(express.json());

app.post('/signup', async (req, res) => {
    const { email, name } = req.body;

    // Add a job named 'email' to the queue with the payload
    await NotificationQueue.add('email', { email, name });

    res.send("Signup successful! Welcome email queued.");
});

app.listen(3000, () => console.log("Server running on port 3000"));
```

---

### 2.4 Understanding the `job` Object
When a worker picks up a job, the `job` object contains structural properties:
* `job.id`: Unique auto-generated string identifier.
* `job.name`: The job category string (e.g., `'email'`).
* `job.data`: The JSON payload sent by the producer (e.g., `{ email, name }`).
* `job.timestamp`: Time when the job was added (Unix timestamp).
* `job.attemptsMade`: How many failed attempts have been recorded so far.

---

## 📌 Section 3: Advanced Queue Features (Cheat Sheet)

### 🔄 3.1 Retries and Exponential Backoff
If a third-party SMTP server is down, we don't want to lose the email. We can schedule automatic retries with exponential delays.
```javascript
await NotificationQueue.add(
    'email',
    { email: 'user@example.com' },
    {
        attempts: 5,
        backoff: {
            type: "exponential",
            delay: 3000 // 3s, 6s, 12s, 24s...
        }
    }
);
```

### ⏱️ 3.2 Delayed Jobs
Send an email after a specific delay (e.g., follow up after 2 hours).
```javascript
await NotificationQueue.add(
    'email',
    { email: 'user@example.com' },
    { delay: 7200000 } // Delay in milliseconds (2 hours)
);
```

### Concurrency (Parallel Processing)
By default, workers handle one job at a time. If you have many users, this causes bottlenecks. Boost performance by letting a worker process multiple jobs concurrently.
```javascript
const worker = new Worker(
    "NotificationQueue",
    processor,
    {
        connection,
        concurrency: 20 // Process up to 20 emails simultaneously
    }
);
```

### 🧹 3.4 Auto-Cleanup (Redis Storage Management)
Redis is an in-memory database. Keeping completed/failed jobs indefinitely will consume all RAM and crash Redis.
```javascript
await NotificationQueue.add(
    'email',
    data,
    {
        removeOnComplete: { count: 1000 }, // Keep only the latest 1000 completed jobs
        removeOnFail: { count: 5000 }      // Keep only the latest 5000 failed jobs
    }
);
```

### 📈 3.5 Progress Tracking
For long-running processes (e.g., exporting files or sending batch newsletters).
```javascript
// Inside worker
await job.updateProgress(50); // Mark 50% completed

// Inside client/API
const job = await NotificationQueue.getJob(jobId);
console.log(`Current progress: ${job.progress}%`);
```

### 📊 3.6 Queue Events
Hook into global state events across your app.
```javascript
import { QueueEvents } from "bullmq";
import connection from "./redis.js";

const events = new QueueEvents("NotificationQueue", { connection });

events.on("completed", ({ jobId }) => {
    console.log(`Job ${jobId} was processed successfully.`);
});

events.on("failed", ({ jobId, failedReason }) => {
    console.log(`Job ${jobId} failed. Reason: ${failedReason}`);
});
```

---

## 📌 Section 4: Deep Dive: Redis & Queue System Internals

### 4.1 How BullMQ Maps to Redis Keys
BullMQ creates and manages namespaced keys in Redis:

| Redis Key Pattern | Redis Type | Description |
| :--- | :--- | :--- |
| `bull:NotificationQueue:wait` | **List** | Ordered sequence of job IDs waiting to be processed. FIFO queue. |
| `bull:NotificationQueue:active` | **Set** | Set of job IDs currently processing by workers. |
| `bull:NotificationQueue:delayed` | **Sorted Set** | Stores job IDs scheduled for a future timestamp. Member score = execution timestamp. |
| `bull:NotificationQueue:completed` | **Set** | Log of completed job IDs. |
| `bull:NotificationQueue:failed` | **Set** | Log of failed job IDs. |
| `bull:NotificationQueue:<jobId>` | **Hash** | Holds actual job data, configuration options, timestamps, and stack traces. |
| `bull:NotificationQueue:<jobId>:lock` | **String** | Token lock representing worker ownership with an active TTL lease. |

---

### 4.2 Atomicity with Lua Scripts
In a distributed queue environment, race conditions are catastrophic (e.g. multiple workers picking up and sending the same welcome email).
* **The Problem**: Reading and writing state transitions requires multiple steps (`GET`, `UPDATE`, `SET`). If done over network calls separately, concurrent processes will overlap.
* **The Solution**: **Lua Scripts**. Redis runs Lua scripts **atomically** in a single thread. BullMQ compiles job claiming and state transition logic into Lua scripts. Redis runs them instantly without allowing context switches, ensuring no two workers can ever claim the same job.

---

### 4.3 Job Lifecycle States

```text
               [ ADDED ]
                   │
                   ▼
             ┌───────────┐
             │  Delayed  │ (If delay option set)
             └─────┬─────┘
                   │ delay expires
                   ▼
             ┌───────────┐
        ┌───►│   Wait    │◄───┐
        │    └─────┬─────┘    │
        │          │          │
        │          │ worker   │ retry /
        │          │ claims   │ backoff
        │          ▼          │
  stalled /  ┌───────────┐    │
  lock lost  │  Active   ├────┘
        │    └─────┬─────┘
        │          │
        │     ┌────┴─────┐
        │     ▼          ▼
        │ ┌───────┐  ┌───────┐
        └─┤ Failed│  │Success│
          └───────┘  └───────┘
```

---

### 4.4 Distributed Locks and Stalled Jobs
* **Distributed Locks**: When a worker claims a job, it registers a lock key (`bull:NotificationQueue:<jobId>:lock`) in Redis with a TTL of 30 seconds. The worker runs a background keep-alive loop to renew this lock every few seconds.
* **Stalled Jobs**: If a worker process crashes, its CPU freezes, or the event loop blocks, it fails to renew the lock. Once the lock key's TTL expires, other workers detect it, declare the job **Stalled**, and move it back to `Wait` to be processed by a healthy worker. 

---

### 4.5 Key Queue Design Principles

#### 1. Idempotency
Because queues guarantee **At-Least-Once Delivery** (due to network retries, worker restarts, or stall recoveries), a worker might execute the same email job twice.
* **Solution**: Your worker process must check an external source (e.g., a database index or a Redis key) before triggering Nodemailer:
  ```javascript
  const alreadySent = await db.emails.findOne({ registrationId: job.data.id });
  if (alreadySent) return;
  ```

#### 2. Backpressure
Backpressure happens when producers add jobs faster than workers can process them, which can fill up Redis memory.
* **Solutions**:
  1. Increase **Concurrency** configurations.
  2. Spawn **more worker containers** dynamically (autoscaling).
  3. Apply **rate limits** to endpoints to restrict intake.

---

### 4.6 Message Broker Comparison: Redis vs. RabbitMQ vs. Kafka

| Feature | Redis (BullMQ) | RabbitMQ | Apache Kafka |
| :--- | :--- | :--- | :--- |
| **Type** | In-memory cache & queue | AMQP Message Broker | Log-based Event Stream |
| **Latency** | **Sub-millisecond** (Fastest) | Milliseconds | Moderate |
| **Complexity** | **Very Low** (uses existing Redis) | Medium | High |
| **Use Case** | Asynchronous jobs, notifications, email queues, scheduled tasks. | Complex routing, enterprise messaging, pub/sub. | Big data ingestion, real-time analytics, event sourcing. |