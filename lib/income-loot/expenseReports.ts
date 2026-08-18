export const EXPENSE_RECOMMENDATIONS=['PAY','WAIT','CANCEL','FIND_FREE_OPTION'] as const
export type ExpenseRecommendation=(typeof EXPENSE_RECOMMENDATIONS)[number]
export const EXPENSE_REPORT_STATES=['COMMANDER_APPROVAL_REQUIRED','APPROVED','DENIED'] as const
export type ExpenseReportState=(typeof EXPENSE_REPORT_STATES)[number]
export type ExpenseReport={id:string;ownerUserId:string;title:string;vendor:string;amount:number;currency:string;recurrence:'ONE_TIME'|'RECURRING';dueDate:string|null;reason:string;subsystem:string;operatingFundAvailable:number;operatingFundCanCover:boolean;effectIfUnpaid:string;cheaperAlternative:string|null;recommendation:ExpenseRecommendation;state:ExpenseReportState;createdAt:string;decidedAt:string|null;decisionActorId:string|null}
const reports:ExpenseReport[]=[];let nextId=1
export type GenerateExpenseReportInput=Omit<ExpenseReport,'id'|'state'|'createdAt'|'decidedAt'|'decisionActorId'|'operatingFundCanCover'>
export function generateExpenseReport(input:GenerateExpenseReportInput,now=new Date().toISOString()):ExpenseReport|null{if(!input.ownerUserId.trim()||!input.title.trim()||!input.vendor.trim()||!Number.isFinite(input.amount)||input.amount<=0||!/^[A-Z]{3}$/.test(input.currency)||!input.reason.trim()||!input.subsystem.trim()||!input.effectIfUnpaid.trim())return null;const report:ExpenseReport={...input,id:`expense_report_session_${nextId++}`,operatingFundCanCover:Number.isFinite(input.operatingFundAvailable)&&input.operatingFundAvailable>=input.amount,state:'COMMANDER_APPROVAL_REQUIRED',createdAt:now,decidedAt:null,decisionActorId:null};reports.unshift(report);return{...report}}
export function decideExpenseReport(ownerUserId:string,id:string,decision:'APPROVED'|'DENIED',actorId:string,now=new Date().toISOString()):ExpenseReport|null{const report=reports.find(item=>item.ownerUserId===ownerUserId&&item.id===id);if(!report||report.state!=='COMMANDER_APPROVAL_REQUIRED'||!actorId.trim())return null;report.state=decision;report.decidedAt=now;report.decisionActorId=actorId;return{...report}}
export function listExpenseReportsForOwner(ownerUserId:string):ExpenseReport[]{return reports.filter(item=>item.ownerUserId===ownerUserId).map(item=>({...item}))}
export const EXPENSE_APPROVAL_EXECUTES_PAYMENT=false as const
export function __resetExpenseReports(){reports.splice(0);nextId=1}
