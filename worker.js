import { Worker } from 'bullmq'
import connection from './redis.js'
import transporter from './mailer.js';


//creating a worker -> 
//worker = new Worker(queue_name that exists in our redis server, and job that exist in queue{with fn that define any job related logic work},{redis_connetion detail})

const worker = new Worker("NotificationQueue", async (job) => {

    switch (job.name) {

        //I am using only email services
        case 'email':
            console.log(job.name);
            console.log(job.data);
            console.log("Sending Email");
            await transporter.sendMail({
                from : process.env.EMAIL,
                to: job.data.email,
                subject:'Welcome',
                text : `Hello ${job.data.name}`
            });
            console.log("Email Sent");
            break;

        case 'Number':
            console.log("I am not using this service for now");
            break;
   }

},
{connection}
);

worker.on('completed', (job) => {
    console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
    console.error(`Job ${job.id} failed with error:`, err);
});
