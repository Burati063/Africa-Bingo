import { PrismaClient } from './node_modules/@prisma/client/index.js';
const p = new PrismaClient();
const rows = await p.deposit.findMany({select:{id:true,txRef:true,provider:true,status:true,amount:true,receiptUrl:true,rawSms:true,paymentMethod:true,providerRef:true,reviewNote:true},take:5});
console.log(JSON.stringify(rows,null,2));
await p.$disconnect();
