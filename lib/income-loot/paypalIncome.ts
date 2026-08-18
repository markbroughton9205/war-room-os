export const PAYPAL_PROVIDER = 'paypal' as const
export const BANK_DEBIT_CAPABILITY = false as const

export const PAYPAL_CONNECTION_STATES = ['NOT_CONFIGURED','BLOCKED_BY_SECURE_VAULT','BLOCKED_BY_ENVIRONMENT','CONFIGURED_NOT_VERIFIED','CONNECTED','LIVE_VERIFIED','ACCESS_DENIED','REAUTH_REQUIRED','API_NOT_SUPPORTED'] as const
export type PayPalConnectionState = (typeof PAYPAL_CONNECTION_STATES)[number]
export const PAYPAL_RECEIPT_STATES = ['PAYPAL_PENDING','PAYPAL_RECEIVED','PAYPAL_HELD','PAYPAL_REVERSED','PAYPAL_REFUNDED','PAYPAL_DENIED','PAYPAL_UNKNOWN'] as const
export type PayPalReceiptState = (typeof PAYPAL_RECEIPT_STATES)[number]

export type PayPalMoney = { amount:number|null; currency:string|null }
export type PayPalIncomingTransaction = {
  provider:typeof PAYPAL_PROVIDER; transactionId:string; referenceId:string|null; transactionTimestamp:string|null
  transactionStatus:string|null; transactionEventCode:string|null; grossAmount:PayPalMoney; feeAmount:PayPalMoney
  netAmount:PayPalMoney; payerDescriptor:string|null; balanceAffecting:string|null; retrievedAt:string
  provenance:{sourceType:'provider_api';endpoint:string}; rawProviderStatus:string|null; receiptState:PayPalReceiptState
}
export type PayPalBalance = { currency:string; primary:boolean|null; availableAmount:number|null; totalAmount:number|null; retrievedAt:string }
export type PayPalConnectionStatus = { state:PayPalConnectionState; liveVerified:boolean; checkedAt:string; reason:string }

type PayPalTransactionInfo={
  paypal_account_id?:string;transaction_id?:string;paypal_reference_id?:string;transaction_initiation_date?:string
  transaction_updated_date?:string;transaction_event_code?:string;transaction_status?:string;transaction_amount?:{currency_code?:string;value?:string}
  fee_amount?:{currency_code?:string;value?:string};ending_balance?:{currency_code?:string;value?:string};balance_affecting_records_only?:string
}
type PayPalTransactionDetail={transaction_info?:PayPalTransactionInfo;payer_info?:{email_address?:string;payer_name?:{given_name?:string;surname?:string}}}

const amount=(value?:string)=>{if(typeof value!=='string'||value.trim()==='')return null;const parsed=Number(value);return Number.isFinite(parsed)?parsed:null}
const money=(value?:{currency_code?:string;value?:string}):PayPalMoney=>({amount:amount(value?.value),currency:value?.currency_code?.trim().toUpperCase()||null})
const payer=(value?:PayPalTransactionDetail['payer_info'])=>value?.email_address?.trim()||[value?.payer_name?.given_name,value?.payer_name?.surname].filter(Boolean).join(' ').trim()||null

export function classifyPayPalReceipt(status:string|null,eventCode:string|null):PayPalReceiptState{
  const normalized=status?.trim().toUpperCase()??''
  const event=eventCode?.trim().toUpperCase()??''
  if(event==='T1107')return'PAYPAL_REFUNDED'
  if(event==='T1106'||normalized==='V')return'PAYPAL_REVERSED'
  if(['T2103','T2105','T2107','T2111'].includes(event))return'PAYPAL_HELD'
  if(normalized==='D')return'PAYPAL_DENIED'
  if(normalized==='P')return'PAYPAL_PENDING'
  if(normalized==='S')return'PAYPAL_RECEIVED'
  return'PAYPAL_UNKNOWN'
}

export function normalizeIncomingPayPalTransaction(detail:PayPalTransactionDetail,retrievedAt=new Date().toISOString()):PayPalIncomingTransaction|null{
  const info=detail.transaction_info,id=info?.transaction_id?.trim()
  const gross=money(info?.transaction_amount)
  if(!id||gross.amount===null||gross.amount<=0)return null
  const rawStatus=info?.transaction_status?.trim()||null,eventCode=info?.transaction_event_code?.trim()||null
  return{provider:PAYPAL_PROVIDER,transactionId:id,referenceId:info?.paypal_reference_id?.trim()||null,transactionTimestamp:info?.transaction_updated_date||info?.transaction_initiation_date||null,transactionStatus:rawStatus,transactionEventCode:eventCode,grossAmount:gross,feeAmount:money(info?.fee_amount),netAmount:{amount:gross.amount-(money(info?.fee_amount).amount??0),currency:gross.currency},payerDescriptor:payer(detail.payer_info),balanceAffecting:info?.balance_affecting_records_only?.trim()||null,retrievedAt,provenance:{sourceType:'provider_api',endpoint:'/v1/reporting/transactions'},rawProviderStatus:rawStatus,receiptState:classifyPayPalReceipt(rawStatus,eventCode)}
}

export interface PayPalIncomeAdapter {
  getConnectionStatus():Promise<PayPalConnectionStatus>
  findIncomingPayments(startDate:string,endDate:string):Promise<PayPalIncomingTransaction[]>
  getBalances():Promise<PayPalBalance[]>
}

type Env=Record<string,string|undefined>
export function getPayPalConfiguredStatus(env:Env=process.env,now=()=>new Date().toISOString()):PayPalConnectionStatus{
  const clientId=env.PAYPAL_CLIENT_ID?.trim()||'',clientSecret=env.PAYPAL_CLIENT_SECRET?.trim()||''
  if(!clientId&&!clientSecret)return{state:'NOT_CONFIGURED',liveVerified:false,checkedAt:now(),reason:'PayPal credentials are not configured in the server environment.'}
  if(!clientId||!clientSecret)return{state:'BLOCKED_BY_ENVIRONMENT',liveVerified:false,checkedAt:now(),reason:'PayPal server credentials are incomplete.'}
  return{state:'CONFIGURED_NOT_VERIFIED',liveVerified:false,checkedAt:now(),reason:'PayPal is configured. Use Refresh PayPal to perform live verification.'}
}
export function createPayPalIncomeAdapter(env:Env=process.env,request:typeof fetch=fetch,now=()=>new Date().toISOString()):PayPalIncomeAdapter{
  const base=env.PAYPAL_API_BASE_URL==='https://api-m.paypal.com'?'https://api-m.paypal.com':'https://api-m.sandbox.paypal.com'
  const credentials=()=>({clientId:env.PAYPAL_CLIENT_ID?.trim()||'',clientSecret:env.PAYPAL_CLIENT_SECRET?.trim()||''})
  async function token():Promise<string>{
    const {clientId,clientSecret}=credentials();if(!clientId||!clientSecret)throw new Error('BLOCKED_BY_ENVIRONMENT')
    const response=await request(`${base}/v1/oauth2/token`,{method:'POST',headers:{authorization:`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:'grant_type=client_credentials',cache:'no-store'})
    if(response.status===401||response.status===403)throw new Error('ACCESS_DENIED')
    if(!response.ok)throw new Error('REAUTH_REQUIRED')
    const body=await response.json() as {access_token?:string};if(!body.access_token)throw new Error('REAUTH_REQUIRED');return body.access_token
  }
  async function authenticated(path:string){const accessToken=await token();return request(`${base}${path}`,{headers:{authorization:`Bearer ${accessToken}`,accept:'application/json'},cache:'no-store'})}
  return{
    async getConnectionStatus(){const configured=getPayPalConfiguredStatus(env,now);if(configured.state!=='CONFIGURED_NOT_VERIFIED')return configured;const checkedAt=now();try{const response=await authenticated('/v1/reporting/balances');if(response.ok)return{state:'LIVE_VERIFIED',liveVerified:true,checkedAt,reason:'A real authenticated PayPal reporting request succeeded.'};if(response.status===401||response.status===403)return{state:'ACCESS_DENIED',liveVerified:false,checkedAt,reason:'PayPal denied reporting access.'};return{state:'CONFIGURED_NOT_VERIFIED',liveVerified:false,checkedAt,reason:`PayPal verification returned HTTP ${response.status}.`}}catch(error){const code=error instanceof Error?error.message:'';const state:PayPalConnectionState=PAYPAL_CONNECTION_STATES.includes(code as PayPalConnectionState)?code as PayPalConnectionState:'CONFIGURED_NOT_VERIFIED';return{state,liveVerified:false,checkedAt,reason:'PayPal connectivity was not verified.'}}
    },
    async findIncomingPayments(startDate,endDate){const params=new URLSearchParams({start_date:startDate,end_date:endDate,fields:'all',page_size:'100',balance_affecting_records_only:'Y'});const response=await authenticated(`/v1/reporting/transactions?${params}`);if(!response.ok)throw new Error(response.status===403?'ACCESS_DENIED':'PAYPAL_REQUEST_FAILED');const body=await response.json() as {transaction_details?:PayPalTransactionDetail[]};return(body.transaction_details??[]).map(item=>normalizeIncomingPayPalTransaction(item,now())).filter((item):item is PayPalIncomingTransaction=>Boolean(item))},
    async getBalances(){const response=await authenticated('/v1/reporting/balances');if(!response.ok)throw new Error(response.status===403?'ACCESS_DENIED':'PAYPAL_REQUEST_FAILED');const body=await response.json() as {balances?:Array<{currency?:string;primary?:boolean;available_balance?:{value?:string};total_balance?:{value?:string}}>};return(body.balances??[]).flatMap(item=>item.currency?[{currency:item.currency.toUpperCase(),primary:typeof item.primary==='boolean'?item.primary:null,availableAmount:amount(item.available_balance?.value),totalAmount:amount(item.total_balance?.value),retrievedAt:now()}]:[])}}
}
