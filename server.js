import express from 'express'
import NotificationQueue from './queue.js';

const app = express();

app.use(express.json());

app.post('/signup', async (req, res) => {
    const user = req.body;
    await NotificationQueue.add('email', { email: user.email, name: user.name }, { attempts: 5, backoff: { type: "exponential", delay: 3000 } }); //(job_name,job_data,{some_rules})
    res.send("Notification sent successfully");
})

app.listen(3000, () => {
    console.log("server is running");
})