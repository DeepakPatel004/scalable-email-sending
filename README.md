# Scalable Email Sending Mechanism (Redis + BullMQ)

A learning project built to understand asynchronous task execution, message queues, and worker processes using Node.js (Express), Redis, BullMQ, and Nodemailer.

## What I learned from this project

This project was built to understand how to design highly scalable, fault-tolerant background systems. Through this, I learned:

1. Producer-consumer design pattern: how to decouple a web API from heavy email-sending operations using a queue so the user gets an instant response.
2. Redis-backed message queues: how Redis manages job states such as waiting, active, delayed, completed, and failed.
3. Distributed locks and reliability: how workers safely lock a job while processing it and how stalled jobs are retried.
4. Resiliency in SMTP systems: how to implement retries and backoff for unstable email providers.
5. Horizontal scalability: how multiple worker instances can process tasks concurrently.

> For a deeper breakdown of the architecture, Redis key mapping, and job lifecycles, see [MoreINFO.md](MoreINFO.md).

## Project structure

```text
scalable-email-sending/
├── redis.js        # Configures the ioredis connection pool
├── queue.js        # Initializes the BullMQ producer queue
├── worker.js       # Listens to Redis and handles the email-sending worker
├── mailer.js       # Configures Nodemailer with SMTP details
├── server.js       # Express API server exposing the signup endpoint
├── MoreINFO.md     # Deep-dive system design notes
├── README.md       # Setup and project documentation
└── package.json    # Project dependencies and scripts
```

## Getting started

### Prerequisites

Make sure you have the following installed:

- Node.js 16 or higher
- Redis running locally or in a container

### Setup instructions

#### 1. Clone the repository

```bash
git clone https://github.com/DeepakPatel004/scalable-email-sending.git
cd scalable-email-sending
```

#### 2. Install dependencies

```bash
npm install
```

#### 3. Configure environment variables

Create a file named `.env` in the project root:

```env
EMAIL=your-gmail-address@gmail.com
PASSWORD=your-gmail-app-password
```

> If you are using Gmail, enable 2-Step Verification and generate an App Password to use instead of your normal account password.

## Running the application

You will need three terminals open for the separate components.

### Terminal 1: Start Redis

```bash
redis-server
```

Or with Docker:

```bash
docker run --name redis-queue -d -p 6379:6379 redis
```

### Terminal 2: Start the API server

```bash
npm start
```

The server will listen on port 3000.

### Terminal 3: Start the worker

```bash
node worker.js
```

The worker will wait for jobs in the `NotificationQueue`.

## Testing the email queue

Send a POST request to the signup endpoint to verify the flow.

```bash
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "johndoe@example.com"}'
```

### What you should see

1. In the API terminal, the request completes quickly and returns `Signup successful! Welcome email queued.`
2. In Redis, BullMQ creates keys such as `bull:NotificationQueue:wait` and stores job metadata.
3. In the worker terminal, you should see logs showing the job being picked up and the email being sent.

```text
Starting job: email (ID: 1)
Email sent successfully to johndoe@example.com
```



## 📌 Core Concepts & Architecture

### Producer (Queue) vs. Consumer (Worker)
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
