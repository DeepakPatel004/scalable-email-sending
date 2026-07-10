import { Queue } from "bullmq";
import connection from "./redis.js"

const NotificationQueue = new Queue("NotificationQueue",{connection}); //(queue_name, redis_connection)

export default NotificationQueue;
