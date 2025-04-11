// scheduler/supplierStatusCheck.js
import cron from 'node-cron';
import Order from '../models/Order.js';
import { getJeskienOrderStatus } from '../services/jeskieincService.js';

const checkOrders = async () => {
    console.log('🔍 Checking supplier order statuses...');
    
    try {
        // Find orders that need status updates
        const orders = await Order.find({
            $or: [
                { status: 'SentToSupplier' },
                { 
                    status: 'Processing', 
                    lastStatusCheck: { $lt: new Date(Date.now() - 15*60*1000) } 
                }
            ],
            supplierOrderId: { $exists: true }
        }).limit(50);

        if (orders.length === 0) {
            console.log('No orders need status checking');
            return;
        }

        // Check status for each order
        for (const order of orders) {
            try {
                const status = await getJeskienOrderStatus(order.supplierOrderId);
                
                let newStatus = order.status;
                if (status.status === 'Completed') newStatus = 'Completed';
                if (status.status === 'Partial') newStatus = 'PartiallyCompleted';
                
                await Order.updateOne(
                    { _id: order._id },
                    { 
                        status: newStatus,
                        supplierStatus: status.status,
                        supplierCharge: status.charge,
                        supplierRemains: status.remains,
                        lastStatusCheck: new Date() 
                    }
                );
                
            } catch (error) {
                console.error(`Failed to check order ${order._id}:`, error);
            }
        }
        
    } catch (error) {
        console.error('Status check failed:', error);
    }
};

// Run every 5 minutes
export const startSupplierStatusChecker = () => {
    cron.schedule('*/5 * * * *', checkOrders).start();
    console.log('🔄 Supplier status checker started');
};