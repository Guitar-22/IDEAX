/**
 * DBA Literature Review rubric, copied from IDEAX-3Gate-mockup.html (criteria and item text are the
 * original English wording, not translated, because it is a real assessment instrument).
 * `hints` are the cue patterns the mock AI uses; a real model would not need them.
 */
import type { ItemHints } from '../ai/provider.js';

export const DBA_RUBRIC = {
  id: 'RBR-DBA-LitReview-01',
  name: 'DBA Assignment — Literature Review Chapter',
  passMark: 3.0,
  source: 'DBA Rubric Literature review (ต้นฉบับไม่ระบุน้ำหนัก %)',
  criteria: [
    {
      id: 'C1',
      no: '1',
      name: 'Storyline',
      purpose: 'to engage the audience and convince them that the research is important, while also educating them about current knowledge and scholarship in your chosen area of expertise',
      th: 'เล่าให้ผู้อ่านเชื่อว่างานนี้สำคัญ และเห็นว่าความรู้ปัจจุบันไปถึงไหนแล้ว',
    },
    {
      id: 'C2',
      no: '2',
      name: 'Conceptualisation and theoretical underpinning',
      purpose: 'to ensure a rigorous academic process of delineating and defining real-world phenomena based upon prior researchers work',
      th: 'นิยามปรากฏการณ์จริงด้วยแนวคิดที่มีรากจากงานวิจัยก่อนหน้า ไม่ใช่คำนิยามที่คิดเอง',
    },
    {
      id: 'C3',
      no: '3',
      name: 'Chapter Structure & Signposting',
      purpose: 'to help readers navigate the complexity and multitude of knowledge covered in the chapter',
      th: 'พาผู้อ่านเดินในบทที่ยาวและซับซ้อนได้โดยไม่หลง',
    },
    {
      id: 'C4',
      no: '4',
      name: 'Academic Referencing',
      purpose: 'to ensure credibility and rigour of your research through appropriate use of prior scholarship',
      th: 'ความน่าเชื่อถือของงานมาจากการใช้งานวิจัยก่อนหน้าอย่างถูกวิธี',
    },
  ],
  items: [
    { c: 'C1', no: '1.1', text: 'The research has a distinct starting point such as a real world problem, a business scenario, or the intention to design a useable artefact',
      hints: { cues: ['falter|problem|challenge|scenario|artefact|artifact', 'successor|inherit'], fbPresent: 'จุดตั้งต้นชัด เห็นทั้งปัญหาและบริบทที่ปัญหาเกิด' } },
    { c: 'C1', no: '1.2', text: 'An account of what we already know about the problem is provided by analysing prior research and identifying distinct bodies of literature',
      hints: { cues: ['bod(y|ies) of (literature|work)', 'prior research|literature'], fbPresent: 'แยกกลุ่มวรรณกรรมได้ ควรเล่าว่าแต่ละกลุ่ม “รู้อะไรแล้ว” ให้ชัดขึ้น' } },
    { c: 'C1', no: '1.3', text: 'There is statement about what is missing from existing research (e.g. gap) and why its important to address',
      hints: { cues: ['has not (yet )?(been )?established|little is known|remains unclear|no (prior )?study|research gap', 'this matters because'], fbPresent: 'มีประโยคที่บอกว่าอะไรยังขาดและทำไมจึงสำคัญ', fbAbsent: 'ยังไม่มีประโยคที่บอกว่าอะไรยังขาด และทำไมการเติมช่องว่างนั้นจึงสำคัญ' } },
    { c: 'C1', no: '1.4', text: 'There is a corresponding explanation of how the current investigation addresses what is missing',
      hints: { cues: ['present (study|investigation)', 'designed (specifically )?to|separate the two explanations|addresses? (the|this) gap'], fbPresent: 'บอกว่างานนี้ทำอะไร ควรผูกกลับไปที่ช่องว่างข้อ 1.3 ให้ชัด' } },

    { c: 'C2', no: '2.1', text: 'Concepts, or a framework, model, or lens are clearly defined and explained',
      hints: { cues: ['\\blens\\b|framework', 'defin(e|es|ing|ition)|construct'], fbPresent: 'นิยาม lens ชัดเจนและใช้ศัพท์เดียวกันตลอดบท' } },
    { c: 'C2', no: '2.2', text: 'Background on the development or emergence of the theoretical ideas from researchers',
      hints: { cues: ['emerged|originat', 'later (narrowed|extended|refined)'], fbPresent: 'มีที่มาของแนวคิด ควรเล่าช่วงที่มีการโต้แย้งกันในวรรณกรรมด้วย' } },
    { c: 'C2', no: '2.3', text: 'Examples of the prior use of theory / concepts for understanding, explaining, or predicting real-world business phenomena, or problems',
      hints: { cues: ['prior applications|applied to', 'studies of|explained variation'], fbPresent: 'มีตัวอย่างการใช้ทฤษฎีกับบริบทธุรกิจจริง' } },
    { c: 'C2', no: '2.4', text: 'An explanation of how the theory / concepts will be used in the research is provided',
      hints: { cues: ['will be used|will (apply|operationali[sz]e)|this study will use'], needs: 'other_chapter' } },

    { c: 'C3', no: '3.1', text: 'Topic sentences introduce key ideas and / or the structure and organisation of a section or subsection',
      hints: { cues: ['this chapter|the chapter (is organi[sz]ed|reviews|now turns)', 'organi[sz]ed around'], fbPresent: 'ประโยคนำหัวข้อทำหน้าที่ได้จริง ผู้อ่านรู้ล่วงหน้าว่าจะเจออะไร' } },
    { c: 'C3', no: '3.2', text: 'Tables or diagrams are used to communicate complex or detailed information, patterns, or trends',
      hints: { needs: 'figure_text', fbPresent: 'ตารางช่วยสื่อกรอบแนวคิดได้ชัด' } },
    { c: 'C3', no: '3.3', text: 'Sections and subsections are used to organise the chapter in a logical sequence and to build arguments',
      hints: { needs: 'section_structure', fbPresent: 'ลำดับหัวข้อสมเหตุสมผล อ่านแล้วต่อกันติด' } },
    { c: 'C3', no: '3.4', text: 'Signposting sentences are used to make connections between different parts of the storyline including linking key points, ideas, or decisions',
      hints: { cues: ['having set out|now turns|in the next section', 'explanations above|as (discussed|shown) above'], fbPresent: 'มีประโยคเชื่อม ควรเพิ่มในช่วงกลางบทด้วย' } },

    { c: 'C4', no: '4.1', text: 'Correct referencing from the guidelines of a target journal is used throughout the chapter',
      hints: { cues: ['\\([A-Z][^()]*,? (19|20)\\d\\d\\)|[A-Z][a-z]+ \\((19|20)\\d\\d\\)'], fbPresent: 'รูปแบบอ้างอิงในเนื้อความสม่ำเสมอ' } },
    { c: 'C4', no: '4.2', text: 'A variety of different citation practices (see Golden-Biddle et al, 2006) are used to utilise evidence, back up claims, and build arguments',
      hints: { cues: ['rarely cite|whereas|in contrast|where the .* literature'], fbPresent: 'ส่วนใหญ่ยังอ้างเพื่อรายงาน ควรอ้างเพื่อสร้างข้อโต้แย้งมากขึ้น' } },
    { c: 'C4', no: '4.3', text: 'Citations of prior work are used to demonstrate comprehension of literature and to identify key authors or important papers',
      hints: { cues: ['(first|second|third) concerns|dominated by|seminal|key authors'], fbPresent: 'ระบุผู้เขียนหลักของแต่ละสายได้' } },
    { c: 'C4', no: '4.4', text: 'The reference list is complete and accurate',
      hints: { needs: 'reference_list', fbPresent: 'แนบรายการอ้างอิงครบ' } },
  ] as Array<{ c: string; no: string; text: string; hints: ItemHints }>,
};

/** Items the precheck looks at (advisory only). */
export const PRECHECK_ITEMS = ['1.3', '1.4', '3.2', '4.4'];

export const CHAPTER_V3 = `2.1 Introduction
Family-owned firms account for a substantial share of Thai SMEs, yet many falter when a second or third generation takes over: the successor inherits a business whose customer records, pricing rules and supplier relationships exist mainly in the founder's memory. This chapter reviews what prior research tells us about that transition. The chapter is organised around three questions: what is known about succession in family firms, how digital adoption has been theorised, and where the two literatures fail to meet.

2.2 Three bodies of literature
Three distinct bodies of literature inform this study. The first concerns succession in family business (Handler, 1994; Nordqvist et al., 2013). The second concerns technology adoption in small firms, dominated by TAM and its extensions (Davis, 1989; Venkatesh & Bala, 2008). The third, smaller and more recent, examines digital capability building in emerging economies. Where the succession literature is largely qualitative and case-based, the adoption literature is overwhelmingly survey-based, and the two rarely cite one another.

2.3 Theoretical framing
This study adopts the dynamic capabilities view (Teece, 2007) as its lens, defining digital capability as the firm's capacity to sense, seize and reconfigure around digital opportunity. The construct emerged from Teece, Pisano and Shuen's (1997) attempt to explain why firms in the same industry respond differently to the same technological shift, and was later narrowed by Eisenhardt and Martin (2000). Prior applications include studies of Thai manufacturing SMEs and of retail chains in Vietnam, where the lens explained variation in adoption speed that firm size alone could not.

2.4 Where the literatures meet
Having set out these three bodies of work and the lens through which they are read, the chapter now turns to what remains unresolved between them.

2.5 Positioning of the present study
The present investigation follows twelve second-generation successors over one academic year.

[Figure 2.1 · Conceptual framework — embedded image, no text layer]
`;

export const CHAPTER_V4 = CHAPTER_V3.replace(
  'the chapter now turns to what remains unresolved between them.',
  "the chapter now turns to what remains unresolved between them. What the succession literature has not established is whether a successor's digital capability is inherited from the founder's systems or built in spite of them; this matters because the two explanations imply opposite interventions for the roughly 2.8 million family SMEs in Thailand.",
)
  .replace(
    'The present investigation follows twelve second-generation successors over one academic year.',
    'The present investigation follows twelve second-generation successors over one academic year, and is designed specifically to separate the two explanations above by observing which systems each successor keeps, replaces or rebuilds.',
  )
  .replace(
    '[Figure 2.1 · Conceptual framework — embedded image, no text layer]',
    'Table 2.1 Conceptual framework: three layers (founder systems, successor capability, firm outcome) with nine components, converted from the former figure into text.',
  );

export const THANAWAT_V1 = `2.1 Introduction
Branch managers in an eight-branch retail chain change every year, and each change loses what the previous manager knew. This chapter reviews research on knowledge transfer in retail.

2.2 Knowledge transfer
Prior research on knowledge transfer separates explicit and tacit knowledge (Nonaka, 1994). Studies of retail chains show that checklists alone do not transfer tacit routines (Szulanski, 1996).

2.3 Positioning
The present study will observe eight branches over two management changes.
`;
