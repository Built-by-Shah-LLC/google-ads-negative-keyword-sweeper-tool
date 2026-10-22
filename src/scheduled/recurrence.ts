import { Temporal } from "@js-temporal/polyfill";

export interface StoredRecurrence { readonly frequency:"daily"|"weekly"|"biweekly"|"monthly"; readonly localTime:string; readonly timeZone:string; readonly weekday:number|null; readonly anchorDate:string|null; readonly monthDay:number|null; }
function wall(date:Temporal.PlainDate,time:Temporal.PlainTime,zone:string){return Temporal.ZonedDateTime.from({timeZone:zone,year:date.year,month:date.month,day:date.day,hour:time.hour,minute:time.minute},{disambiguation:"compatible"}).toInstant();}
function monthly(date:Temporal.PlainDate,day:number){const first=date.with({day:1});return first.with({day:Math.min(day,first.daysInMonth)});}
export function nextScheduledInstant(rule:StoredRecurrence,after:Temporal.Instant):Temporal.Instant{
  const time=Temporal.PlainTime.from(rule.localTime); const local=after.toZonedDateTimeISO(rule.timeZone); let date=local.toPlainDate();
  if(rule.frequency==="weekly")date=date.add({days:(rule.weekday!-date.dayOfWeek+7)%7});
  else if(rule.frequency==="biweekly"){const anchor=Temporal.PlainDate.from(rule.anchorDate!);if(Temporal.PlainDate.compare(date,anchor)<=0)date=anchor;else{const days=anchor.until(date,{largestUnit:"day"}).days;date=anchor.add({days:Math.floor(days/14)*14});if(Temporal.PlainDate.compare(date,local.toPlainDate())<0)date=date.add({days:14});}}
  else if(rule.frequency==="monthly")date=monthly(date,rule.monthDay!);
  let result=wall(date,time,rule.timeZone);
  while(Temporal.Instant.compare(result,after)<=0){if(rule.frequency==="daily")date=date.add({days:1});else if(rule.frequency==="weekly")date=date.add({days:7});else if(rule.frequency==="biweekly")date=date.add({days:14});else date=monthly(date.add({months:1}),rule.monthDay!);result=wall(date,time,rule.timeZone);}
  return result;
}

