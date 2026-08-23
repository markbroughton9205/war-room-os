import type { EligibilityQuestion } from './types'
const rules:Array<[RegExp,string,string]>=[
  [/Washington residents?|residing in Washington/i,'washington_residence','Were you a Washington resident when you received the relevant commercial email?'],
  [/received (?:a )?commercial (?:electronic mail message|email)/i,'received_email','Did you receive the relevant commercial email during the official class period?'],
  [/ordered|purchased (?:merchandise|a product|products?)/i,'purchase','Did you make a qualifying purchase during the official class period?'],
  [/assessed and paid a handling fee|charged (?:and paid )?a handling fee/i,'handling_fee','Were you assessed and did you pay the relevant handling fee?'],
  [/account holders?|had an account/i,'account','Did you have the relevant account during the official class period?'],
  [/used (?:the|a) (?:service|product)/i,'use','Did you use the relevant product or service during the official class period?']
]
export function deriveEligibilityQuestions(classDefinition:string|null,knownFacts:Record<string,boolean|undefined>={}):EligibilityQuestion[]{
  if(!classDefinition)return [{id:'official_class_definition',fact:'official_class_definition',prompt:'Review the official class definition; required eligibility facts could not be parsed.'}]
  return rules.filter(([pattern,fact])=>pattern.test(classDefinition)&&knownFacts[fact]===undefined).map(([,fact,prompt])=>({id:fact,fact,prompt}))
}
