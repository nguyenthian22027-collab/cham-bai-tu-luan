import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  Timestamp,
  deleteField,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  AppUser,
  AttendanceRecord,
  ClassItem,
  DashboardStats,
  Gradebook,
  GradeColumn,
  GradeColumnType,
  GradeRow,
  ClassPaymentConfig,
  TuitionPaymentRecord,
  TuitionPaymentStatus,
  ParentClassReport,
  ParentReport,
  Role,
  ScoreRecord,
  Student,
  TuitionData,
  TuitionStudentRow,
} from '../types';

const toDate = (v: unknown): Date | undefined =>
  v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : undefined;

/** Make a string safe to use as a Firestore document id (no slashes etc). */
const safeId = (s: string) =>
  encodeURIComponent(s).replace(/[^A-Za-z0-9_-]/g, '_');

export const todayStr = () => new Date().toISOString().slice(0, 10);

const chunkArray = <T,>(arr: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

// ===================================================================
//  CLASSES
// ===================================================================
const mapClass = (id: string, d: Record<string, unknown>): ClassItem => ({
  id,
  className: (d.className as string) || '',
  subject: (d.subject as string) || '',
  grade: (d.grade as string) || '',
  feePerSession: Number(d.feePerSession) || 0,
  startDate: (d.startDate as string) || '',
  status: (d.status as ClassItem['status']) || 'ACTIVE',
  createdAt: toDate(d.createdAt),
});

/** Admin sees all classes; teacher/TA sees only assigned classes. */
export const getClasses = async (user: AppUser): Promise<ClassItem[]> => {
  if (user.role === Role.ADMIN) {
    const snap = await getDocs(collection(db, 'classes'));
    return snap.docs
      .map((d) => mapClass(d.id, d.data()))
      .sort((a, b) => a.className.localeCompare(b.className));
  }

  const ctSnap = await getDocs(
    query(collection(db, 'classTeachers'), where('teacherId', '==', user.id))
  );
  const classIds = [...new Set(ctSnap.docs.map((d) => d.data().classId as string))];
  const classes = await Promise.all(
    classIds.map(async (cid) => {
      const cs = await getDoc(doc(db, 'classes', cid));
      return cs.exists() ? mapClass(cs.id, cs.data()) : null;
    })
  );

  return classes
    .filter((c): c is ClassItem => c !== null)
    .sort((a, b) => a.className.localeCompare(b.className));
};

export const getClassById = async (id: string): Promise<ClassItem | null> => {
  const s = await getDoc(doc(db, 'classes', id));
  return s.exists() ? mapClass(s.id, s.data()) : null;
};

export const addClass = (data: Omit<ClassItem, 'id' | 'createdAt'>) =>
  addDoc(collection(db, 'classes'), {
    ...data,
    feePerSession: Number(data.feePerSession) || 0,
    createdAt: serverTimestamp(),
  });

export const updateClass = (id: string, data: Partial<ClassItem>) =>
  updateDoc(doc(db, 'classes', id), {
    ...data,
    ...(data.feePerSession !== undefined
      ? { feePerSession: Number(data.feePerSession) || 0 }
      : {}),
  });

// ===================================================================
//  STUDENTS
// ===================================================================
const mapStudent = (id: string, d: Record<string, unknown>): Student => ({
  id,
  fullName: (d.fullName as string) || '',
  studentClass: (d.studentClass as string) || '',
  parentName: (d.parentName as string) || '',
  parentPhone: (d.parentPhone as string) || '',
  parentEmail: (d.parentEmail as string) || '',
  studentEmail: ((d.studentEmail as string) || '').trim().toLowerCase(),
  note: (d.note as string) || '',
  status: (d.status as Student['status']) || 'ACTIVE',
  createdAt: toDate(d.createdAt),
});

export const getStudents = async (): Promise<Student[]> => {
  const snap = await getDocs(collection(db, 'students'));
  return snap.docs
    .map((d) => mapStudent(d.id, d.data()))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
};

export const getStudentById = async (id: string): Promise<Student | null> => {
  const s = await getDoc(doc(db, 'students', id));
  return s.exists() ? mapStudent(s.id, s.data()) : null;
};

const STUDENT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeStudentEmail(value?: string): string {
  const email = String(value || '').trim().toLowerCase();
  if (email && !STUDENT_EMAIL_RE.test(email)) {
    throw new Error(`Email Google học sinh không hợp lệ: ${email}`);
  }
  return email;
}

async function assertStudentEmailAvailable(studentEmail?: string, excludeStudentId?: string) {
  const email = normalizeStudentEmail(studentEmail);
  if (!email) return;
  const snap = await getDocs(query(collection(db, 'students'), where('studentEmail', '==', email)));
  const duplicate = snap.docs.find((item) => item.id !== excludeStudentId);
  if (duplicate) throw new Error(`Email Google học sinh ${email} đã được gán cho hồ sơ khác.`);
}

export async function addStudent(data: Omit<Student, 'id' | 'createdAt'>) {
  const payload = { ...data, studentEmail: normalizeStudentEmail(data.studentEmail) };
  await assertStudentEmailAvailable(payload.studentEmail);
  return addDoc(collection(db, 'students'), { ...payload, createdAt: serverTimestamp() });
}

export async function updateStudent(id: string, data: Partial<Student>) {
  const payload = data.studentEmail === undefined
    ? data
    : { ...data, studentEmail: normalizeStudentEmail(data.studentEmail) };
  await assertStudentEmailAvailable(payload.studentEmail, id);
  return updateDoc(doc(db, 'students', id), payload);
}

export interface ImportStudentInput {
  fullName: string;
  studentClass?: string;
  parentName?: string;
  parentPhone?: string;
  parentEmail?: string;
  studentEmail?: string;
  note?: string;
  status?: Student['status'];
}

export interface ImportStudentsResult {
  created: number;
  existed: number;
  enrolled: number;
  skipped: number;
  errors: string[];
}

const cleanText = (v: unknown) => String(v ?? '').trim();

const studentImportKey = (s: { fullName: string; parentPhone?: string; studentClass?: string }) =>
  `${cleanText(s.fullName).toLowerCase()}__${cleanText(s.parentPhone || s.studentClass).toLowerCase()}`;

export const importStudents = async (
  rows: ImportStudentInput[],
  classId?: string
): Promise<ImportStudentsResult> => {
  const result: ImportStudentsResult = {
    created: 0,
    existed: 0,
    enrolled: 0,
    skipped: 0,
    errors: [],
  };

  if (!rows.length) return result;

  const existing = await getStudents();
  const existingByKey = new Map<string, Student>();
  existing.forEach((s) => {
    const key = studentImportKey(s);
    if (s.fullName && !existingByKey.has(key)) existingByKey.set(key, s);
  });

  const seenInFile = new Set<string>();
  const existingEmailOwner = new Map(
    existing
      .filter((student) => student.studentEmail)
      .map((student) => [student.studentEmail.toLowerCase(), student.id] as const),
  );
  const seenStudentEmails = new Set<string>();
  const ops: {
    studentId: string;
    create: boolean;
    studentRef?: DocumentReference;
    payload: Omit<Student, 'id' | 'createdAt'>;
  }[] = [];

  rows.forEach((row, index) => {
    const payload: Omit<Student, 'id' | 'createdAt'> = {
      fullName: cleanText(row.fullName),
      studentClass: cleanText(row.studentClass),
      parentName: cleanText(row.parentName),
      parentPhone: cleanText(row.parentPhone),
      parentEmail: cleanText(row.parentEmail),
      studentEmail: cleanText(row.studentEmail).toLowerCase(),
      note: cleanText(row.note),
      status: row.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    };

    if (!payload.fullName) {
      result.skipped += 1;
      result.errors.push(`Dòng ${index + 2}: thiếu họ tên học sinh`);
      return;
    }

    if (payload.studentEmail) {
      const email = payload.studentEmail.toLowerCase();
      if (!STUDENT_EMAIL_RE.test(email)) {
        result.skipped += 1;
        result.errors.push(`Dòng ${index + 2}: email Google học sinh không hợp lệ (${email})`);
        return;
      }
      if (seenStudentEmails.has(email)) {
        result.skipped += 1;
        result.errors.push(`Dòng ${index + 2}: Gmail học sinh bị trùng trong file (${email})`);
        return;
      }
      const ownerId = existingEmailOwner.get(email);
      if (ownerId) {
        result.skipped += 1;
        result.errors.push(`Dòng ${index + 2}: Gmail ${email} đã thuộc một hồ sơ học sinh khác`);
        return;
      }
      seenStudentEmails.add(email);
    }

    const key = studentImportKey(payload);
    if (seenInFile.has(key)) {
      result.skipped += 1;
      result.errors.push(`Dòng ${index + 2}: trùng học sinh trong file (${payload.fullName})`);
      return;
    }
    seenInFile.add(key);

    const existed = existingByKey.get(key);
    if (existed) {
      result.existed += 1;
      ops.push({ studentId: existed.id, create: false, payload });
      return;
    }

    const ref = doc(collection(db, 'students'));
    existingByKey.set(key, { id: ref.id, ...payload });
    result.created += 1;
    ops.push({ studentId: ref.id, studentRef: ref, create: true, payload });
  });

  for (const chunk of chunkArray(ops, 240)) {
    const batch = writeBatch(db);
    chunk.forEach((op) => {
      if (op.create && op.studentRef) {
        batch.set(op.studentRef, {
          ...op.payload,
          createdAt: serverTimestamp(),
        });
      }

      if (classId) {
        batch.set(doc(db, 'enrollments', `${classId}__${op.studentId}`), {
          studentId: op.studentId,
          classId,
          createdAt: serverTimestamp(),
        });
        result.enrolled += 1;
      }
    });
    await batch.commit();
  }

  return result;
};

export const deleteStudents = async (ids: string[]) => {
  for (const id of ids) await deleteStudent(id);
};

export const removeEnrollments = async (studentIds: string[], classId: string) => {
  for (const chunk of chunkArray(studentIds, 440)) {
    const batch = writeBatch(db);
    chunk.forEach((studentId) => {
      batch.delete(doc(db, 'enrollments', `${classId}__${studentId}`));
    });
    await batch.commit();
  }
};

export const deleteStudent = async (id: string) => {
  const [enrollments, accounts] = await Promise.all([
    getDocs(query(collection(db, 'enrollments'), where('studentId', '==', id))),
    getDocs(query(collection(db, 'studentAccounts'), where('studentId', '==', id))),
  ]);

  const refs = [
    doc(db, 'students', id),
    ...enrollments.docs.map((item) => item.ref),
    ...accounts.docs.map((item) => item.ref),
  ];

  for (const chunk of chunkArray(refs, 440)) {
    const batch = writeBatch(db);
    chunk.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

// ===================================================================
//  ENROLLMENTS (roster)
// ===================================================================
export const getClassRoster = async (classId: string): Promise<Student[]> => {
  const enr = await getDocs(
    query(collection(db, 'enrollments'), where('classId', '==', classId))
  );
  const studentIds = enr.docs.map((d) => d.data().studentId as string);
  const students = await Promise.all(studentIds.map((sid) => getStudentById(sid)));
  return students
    .filter((s): s is Student => s !== null)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
};

export const enrollStudent = (studentId: string, classId: string) =>
  setDoc(doc(db, 'enrollments', `${classId}__${studentId}`), {
    studentId,
    classId,
    createdAt: serverTimestamp(),
  });

export const removeEnrollment = (studentId: string, classId: string) =>
  deleteDoc(doc(db, 'enrollments', `${classId}__${studentId}`));

// ===================================================================
//  CLASS TEACHERS
// ===================================================================
export const getClassTeachers = async (classId: string): Promise<AppUser[]> => {
  const ct = await getDocs(
    query(collection(db, 'classTeachers'), where('classId', '==', classId))
  );
  const ids = ct.docs.map((d) => d.data().teacherId as string);
  const users = await Promise.all(
    ids.map(async (uid) => {
      const u = await getDoc(doc(db, 'users', uid));
      if (!u.exists()) return null;
      const d = u.data();
      return {
        id: u.id,
        name: (d.name as string) || '',
        email: d.email as string,
        avatar: d.avatar as string,
        role: (d.role as Role) || Role.TEACHER,
        isApproved: (d.isApproved as boolean) ?? false,
      } as AppUser;
    })
  );
  return users.filter((u): u is AppUser => u !== null);
};

export const assignTeacher = (teacherId: string, classId: string) =>
  setDoc(doc(db, 'classTeachers', `${classId}__${teacherId}`), {
    teacherId,
    classId,
    createdAt: serverTimestamp(),
  });

export const removeTeacherFromClass = (teacherId: string, classId: string) =>
  deleteDoc(doc(db, 'classTeachers', `${classId}__${teacherId}`));

// ===================================================================
//  ATTENDANCE
// ===================================================================
const mapAtt = (id: string, d: Record<string, unknown>): AttendanceRecord => ({
  id,
  classId: (d.classId as string) || '',
  studentId: (d.studentId as string) || '',
  date: (d.date as string) || '',
  present: (d.present as boolean) ?? false,
  note: (d.note as string) || '',
});

export const getAttendance = async (
  classId: string,
  date: string
): Promise<AttendanceRecord[]> => {
  const snap = await getDocs(
    query(
      collection(db, 'attendance'),
      where('classId', '==', classId),
      where('date', '==', date)
    )
  );
  return snap.docs.map((d) => mapAtt(d.id, d.data()));
};

export const markAttendance = async (
  classId: string,
  date: string,
  records: { studentId: string; present: boolean; note: string }[]
) => {
  const batch = writeBatch(db);
  records.forEach((r) => {
    const id = `${classId}__${date}__${r.studentId}`;
    batch.set(doc(db, 'attendance', id), {
      classId,
      date,
      studentId: r.studentId,
      present: r.present,
      note: r.note || '',
    });
  });
  await batch.commit();
};

// ===================================================================
//  SCORES - LEGACY
// ===================================================================
const mapScore = (id: string, d: Record<string, unknown>): ScoreRecord => ({
  id,
  classId: (d.classId as string) || '',
  studentId: (d.studentId as string) || '',
  examName: (d.examName as string) || '',
  score: Number(d.score) || 0,
  maxScore: Number(d.maxScore) || 10,
  date: (d.date as string) || '',
  note: (d.note as string) || '',
});

export const getScores = async (
  classId: string,
  examName?: string
): Promise<ScoreRecord[]> => {
  const constraints = [where('classId', '==', classId)];
  if (examName) constraints.push(where('examName', '==', examName));
  const snap = await getDocs(query(collection(db, 'scores'), ...constraints));
  return snap.docs.map((d) => mapScore(d.id, d.data()));
};

export const saveScores = async (
  classId: string,
  examName: string,
  maxScore: number,
  date: string,
  records: { studentId: string; score: number }[]
) => {
  const batch = writeBatch(db);
  records.forEach((r) => {
    const id = `${classId}__${safeId(examName)}__${r.studentId}`;
    batch.set(doc(db, 'scores', id), {
      classId,
      studentId: r.studentId,
      examName,
      score: r.score,
      maxScore,
      date,
      note: '',
    });
  });
  await batch.commit();
};

// ===================================================================
//  GRADEBOOK - NEW EXCEL-LIKE SCORE ENTRY
// ===================================================================
export const getClassGradebookId = (classId: string) => `${classId}__MAIN`;

const mapGradebook = (id: string, d: Record<string, unknown>): Gradebook => ({
  id,
  classId: (d.classId as string) || '',
  className: (d.className as string) || '',
  subject: (d.subject as string) || '',
  grade: (d.grade as string) || '',
  semester: (d.semester as string) || 'DEFAULT',
  schoolYear: (d.schoolYear as string) || '',
  createdBy: d.createdBy as string | undefined,
  legacyMigrated: Boolean(d.legacyMigrated),
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt),
});

const mapGradeColumn = (id: string, d: Record<string, unknown>): GradeColumn => ({
  id,
  name: (d.name as string) || '',
  type: (d.type as GradeColumnType) || 'REGULAR',
  maxScore: Number(d.maxScore) || 10,
  weight: Number(d.weight) || 1,
  order: Number(d.order) || 0,
  examDate: (d.examDate as string) || '',
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt),
});

const mapGradeRow = (id: string, d: Record<string, unknown>): GradeRow => ({
  id,
  studentId: (d.studentId as string) || id,
  fullName: (d.fullName as string) || '',
  studentClass: (d.studentClass as string) || '',
  scores: ((d.scores as Record<string, number>) || {}) ?? {},
  average10: d.average10 === null || d.average10 === undefined ? null : Number(d.average10),
  updatedAt: toDate(d.updatedAt),
  updatedBy: d.updatedBy as string | undefined,
});

export const calcGradeAverage10 = (
  scores: Record<string, number>,
  columns: GradeColumn[]
): number | null => {
  let total = 0;
  let weightTotal = 0;

  columns.forEach((col) => {
    const score = scores[col.id];
    if (score === undefined || score === null || !Number.isFinite(Number(score))) return;
    if (col.maxScore <= 0 || col.weight <= 0) return;

    total += (Number(score) / col.maxScore) * 10 * col.weight;
    weightTotal += col.weight;
  });

  if (!weightTotal) return null;
  return Math.round((total / weightTotal) * 10) / 10;
};

export const getOrCreateClassGradebook = async (
  classInfo: ClassItem,
  userId?: string
): Promise<Gradebook> => {
  const gradebookId = getClassGradebookId(classInfo.id);
  const ref = doc(db, 'gradebooks', gradebookId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      classId: classInfo.id,
      className: classInfo.className,
      subject: classInfo.subject,
      grade: classInfo.grade,
      semester: 'DEFAULT',
      schoolYear: '',
      createdBy: userId || '',
      legacyMigrated: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(ref, {
      className: classInfo.className,
      subject: classInfo.subject,
      grade: classInfo.grade,
      updatedAt: serverTimestamp(),
    });
  }

  const latest = await getDoc(ref);
  return mapGradebook(latest.id, latest.data() || {});
};

export const getGradeColumns = async (gradebookId: string): Promise<GradeColumn[]> => {
  const snap = await getDocs(collection(db, 'gradebooks', gradebookId, 'columns'));
  return snap.docs
    .map((d) => mapGradeColumn(d.id, d.data()))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
};

export const getGradeRows = async (gradebookId: string): Promise<GradeRow[]> => {
  const snap = await getDocs(collection(db, 'gradebooks', gradebookId, 'rows'));
  return snap.docs.map((d) => mapGradeRow(d.id, d.data()));
};

export const addGradeColumn = async (
  gradebookId: string,
  data: {
    name: string;
    type: GradeColumnType;
    maxScore: number;
    weight: number;
    examDate: string;
    order: number;
  }
) => {
  return addDoc(collection(db, 'gradebooks', gradebookId, 'columns'), {
    name: data.name.trim(),
    type: data.type,
    maxScore: Number(data.maxScore) || 10,
    weight: Number(data.weight) || 1,
    examDate: data.examDate || todayStr(),
    order: Number(data.order) || 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const updateGradeColumn = (
  gradebookId: string,
  columnId: string,
  data: Partial<Omit<GradeColumn, 'id' | 'createdAt' | 'updatedAt'>>
) => {
  const payload: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.maxScore !== undefined) payload.maxScore = Number(data.maxScore) || 10;
  if (data.weight !== undefined) payload.weight = Number(data.weight) || 1;
  if (data.order !== undefined) payload.order = Number(data.order) || 0;
  return updateDoc(doc(db, 'gradebooks', gradebookId, 'columns', columnId), payload);
};

export const deleteGradeColumnAndScores = async (
  gradebookId: string,
  columnId: string
) => {
  const rows = await getDocs(collection(db, 'gradebooks', gradebookId, 'rows'));
  const ops = rows.docs.map((r) => r.ref);

  for (const chunk of chunkArray(ops, 440)) {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'gradebooks', gradebookId, 'columns', columnId));
    chunk.forEach((ref) => {
      batch.update(ref, {
        [`scores.${columnId}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }

  if (ops.length === 0) {
    await deleteDoc(doc(db, 'gradebooks', gradebookId, 'columns', columnId));
  }
};

export const saveGradeRows = async (
  gradebookId: string,
  columns: GradeColumn[],
  rows: {
    studentId: string;
    fullName: string;
    studentClass: string;
    scores: Record<string, number>;
  }[],
  userId?: string
) => {
  for (const chunk of chunkArray(rows, 440)) {
    const batch = writeBatch(db);

    chunk.forEach((row) => {
      const average10 = calcGradeAverage10(row.scores, columns);
      batch.set(doc(db, 'gradebooks', gradebookId, 'rows', row.studentId), {
        studentId: row.studentId,
        fullName: row.fullName,
        studentClass: row.studentClass || '',
        scores: row.scores,
        average10,
        updatedAt: serverTimestamp(),
        updatedBy: userId || '',
      });
    });

    await batch.commit();
  }

  await updateDoc(doc(db, 'gradebooks', gradebookId), {
    legacyMigrated: true,
    updatedAt: serverTimestamp(),
  });
};

/**
 * Tự chuyển điểm cũ trong collection /scores sang sổ điểm mới.
 * Chỉ chạy khi sổ điểm mới chưa có cột nào, nên không tạo dữ liệu trùng.
 */
export const migrateLegacyScoresToGradebook = async (
  classId: string,
  gradebookId: string,
  roster: Student[],
  userId?: string
): Promise<boolean> => {
  const gradebookRef = doc(db, 'gradebooks', gradebookId);
  const gradebookSnap = await getDoc(gradebookRef);
  if (gradebookSnap.exists() && gradebookSnap.data().legacyMigrated === true) return false;

  const existingColumns = await getGradeColumns(gradebookId);
  if (existingColumns.length > 0) {
    await updateDoc(gradebookRef, { legacyMigrated: true, updatedAt: serverTimestamp() });
    return false;
  }

  const legacyScores = await getScores(classId);
  if (legacyScores.length === 0) {
    await updateDoc(gradebookRef, { legacyMigrated: true, updatedAt: serverTimestamp() });
    return false;
  }

  const examNames = [...new Set(legacyScores.map((s) => s.examName).filter(Boolean))];
  if (examNames.length === 0) return false;

  const columns: GradeColumn[] = examNames.map((name, index) => {
    const sample = legacyScores.find((s) => s.examName === name);
    return {
      id: `legacy__${safeId(name)}`,
      name,
      type: 'REGULAR',
      maxScore: sample?.maxScore || 10,
      weight: 1,
      order: index + 1,
      examDate: sample?.date || todayStr(),
    };
  });

  const rowByStudent: Record<string, { student: Student; scores: Record<string, number> }> = {};
  roster.forEach((s) => {
    rowByStudent[s.id] = { student: s, scores: {} };
  });

  legacyScores.forEach((score) => {
    const col = columns.find((c) => c.name === score.examName);
    if (!col || !rowByStudent[score.studentId]) return;
    rowByStudent[score.studentId].scores[col.id] = score.score;
  });

  const rowPayloads = Object.values(rowByStudent).filter(
    (r) => Object.keys(r.scores).length > 0
  );

  const batch = writeBatch(db);
  columns.forEach((col) => {
    batch.set(doc(db, 'gradebooks', gradebookId, 'columns', col.id), {
      name: col.name,
      type: col.type,
      maxScore: col.maxScore,
      weight: col.weight,
      order: col.order,
      examDate: col.examDate,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  rowPayloads.forEach((r) => {
    batch.set(doc(db, 'gradebooks', gradebookId, 'rows', r.student.id), {
      studentId: r.student.id,
      fullName: r.student.fullName,
      studentClass: r.student.studentClass || '',
      scores: r.scores,
      average10: calcGradeAverage10(r.scores, columns),
      updatedAt: serverTimestamp(),
      updatedBy: userId || '',
    });
  });
  await batch.commit();

  await updateDoc(doc(db, 'gradebooks', gradebookId), {
    legacyMigrated: true,
    updatedAt: serverTimestamp(),
  });

  return true;
};

export const getGradebookScoresForStudent = async (
  classId: string,
  studentId: string
): Promise<{ scores: ScoreRecord[]; average10: number | null }> => {
  const gradebookId = getClassGradebookId(classId);
  const [columns, rowSnap] = await Promise.all([
    getGradeColumns(gradebookId),
    getDoc(doc(db, 'gradebooks', gradebookId, 'rows', studentId)),
  ]);

  if (!rowSnap.exists() || columns.length === 0) return { scores: [], average10: null };

  const row = mapGradeRow(rowSnap.id, rowSnap.data());
  const scores = columns
    .filter((col) => row.scores[col.id] !== undefined && row.scores[col.id] !== null)
    .map((col) => ({
      id: `${gradebookId}__${col.id}__${studentId}`,
      classId,
      studentId,
      examName: col.name,
      score: Number(row.scores[col.id]),
      maxScore: col.maxScore,
      date: col.examDate,
      note: col.type,
    }));

  return { scores, average10: row.average10 };
};


// ===================================================================
//  PAYMENT CONFIG / TUITION PAYMENT CONFIRMATION
// ===================================================================
const mapClassPaymentConfig = (
  id: string,
  d: Record<string, unknown>
): ClassPaymentConfig => ({
  classId: (d.classId as string) || id,
  mode: (d.mode as ClassPaymentConfig['mode']) || 'GLOBAL',
  bankId: (d.bankId as string) || '',
  bankAccount: (d.bankAccount as string) || '',
  bankAccountName: (d.bankAccountName as string) || '',
  qrTemplate: (d.qrTemplate as string) || 'compact2',
  notePattern: (d.notePattern as string) || '{CLASS}_{STUDENT}_HP THANG {MONTH}',
  isEnabled: (d.isEnabled as boolean) ?? true,
  updatedAt: toDate(d.updatedAt),
  updatedBy: d.updatedBy as string | undefined,
});

const paymentDocId = (classId: string, monthKey: string, studentId: string) =>
  `${classId}__${monthKey}__${studentId}`;

const mapTuitionPaymentRecord = (
  id: string,
  d: Record<string, unknown>
): TuitionPaymentRecord => ({
  id,
  classId: (d.classId as string) || '',
  studentId: (d.studentId as string) || '',
  monthKey: (d.monthKey as string) || '',
  amount: Number(d.amount) || 0,
  transferNote: (d.transferNote as string) || '',
  status: (d.status as TuitionPaymentStatus) || 'UNPAID',
  confirmedAt: toDate(d.confirmedAt),
  confirmedBy: d.confirmedBy as string | undefined,
  confirmedByName: d.confirmedByName as string | undefined,
  note: (d.note as string) || '',
  updatedAt: toDate(d.updatedAt),
});

export const getClassPaymentConfig = async (
  classId: string
): Promise<ClassPaymentConfig | null> => {
  const snap = await getDoc(doc(db, 'classPaymentConfigs', classId));
  return snap.exists() ? mapClassPaymentConfig(snap.id, snap.data()) : null;
};

export const saveClassPaymentConfig = async (
  classId: string,
  data: Partial<ClassPaymentConfig>,
  userId?: string
) => {
  await setDoc(
    doc(db, 'classPaymentConfigs', classId),
    {
      classId,
      mode: data.mode || 'GLOBAL',
      bankId: data.bankId || '',
      bankAccount: data.bankAccount || '',
      bankAccountName: data.bankAccountName || '',
      qrTemplate: data.qrTemplate || 'compact2',
      notePattern: data.notePattern || '{CLASS}_{STUDENT}_HP THANG {MONTH}',
      isEnabled: data.isEnabled ?? true,
      updatedAt: serverTimestamp(),
      updatedBy: userId || '',
    },
    { merge: true }
  );
};

export const getTuitionPayment = async (
  classId: string,
  studentId: string,
  monthKey: string
): Promise<TuitionPaymentRecord | null> => {
  const snap = await getDoc(
    doc(db, 'tuitionPayments', paymentDocId(classId, monthKey, studentId))
  );
  return snap.exists() ? mapTuitionPaymentRecord(snap.id, snap.data()) : null;
};

export const getTuitionPaymentsForClassMonth = async (
  classId: string,
  monthKey: string
): Promise<TuitionPaymentRecord[]> => {
  const snap = await getDocs(
    query(
      collection(db, 'tuitionPayments'),
      where('classId', '==', classId),
      where('monthKey', '==', monthKey)
    )
  );
  return snap.docs.map((d) => mapTuitionPaymentRecord(d.id, d.data()));
};

export const setTuitionPaymentStatus = async (params: {
  classId: string;
  studentId: string;
  monthKey: string;
  amount: number;
  transferNote: string;
  status: TuitionPaymentStatus;
  confirmedBy?: string;
  confirmedByName?: string;
  note?: string;
}) => {
  const id = paymentDocId(params.classId, params.monthKey, params.studentId);
  await setDoc(
    doc(db, 'tuitionPayments', id),
    {
      classId: params.classId,
      studentId: params.studentId,
      monthKey: params.monthKey,
      amount: Number(params.amount) || 0,
      transferNote: params.transferNote || '',
      status: params.status,
      confirmedAt: params.status === 'PAID' ? serverTimestamp() : null,
      confirmedBy: params.status === 'PAID' ? params.confirmedBy || '' : '',
      confirmedByName: params.status === 'PAID' ? params.confirmedByName || '' : '',
      note: params.note || '',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

// ===================================================================
//  TUITION
// ===================================================================
export const getTuition = async (classId: string): Promise<TuitionData> => {
  const classInfo = await getClassById(classId);
  if (!classInfo) throw new Error('Không tìm thấy lớp học');

  const roster = await getClassRoster(classId);
  const attSnap = await getDocs(
    query(collection(db, 'attendance'), where('classId', '==', classId))
  );
  const att = attSnap.docs.map((d) => mapAtt(d.id, d.data()));
  const sessionsTotal = new Set(att.map((a) => a.date)).size;

  const students: TuitionStudentRow[] = roster.map((s) => {
    const mine = att.filter((a) => a.studentId === s.id);
    const attended = mine.filter((a) => a.present).length;
    const absent = mine.filter((a) => !a.present).length;
    return {
      studentId: s.id,
      fullName: s.fullName,
      sessionsTotal,
      sessionsAttended: attended,
      sessionsAbsent: absent,
      feePerSession: classInfo.feePerSession,
      tuition: attended * classInfo.feePerSession,
    };
  });

  return { classInfo, students };
};


export const getTuitionForMonth = async (
  classId: string,
  monthKey: string
): Promise<TuitionData> => {
  const classInfo = await getClassById(classId);
  if (!classInfo) throw new Error('Không tìm thấy lớp học');

  const roster = await getClassRoster(classId);
  const attSnap = await getDocs(
    query(collection(db, 'attendance'), where('classId', '==', classId))
  );
  const att = attSnap.docs
    .map((d) => mapAtt(d.id, d.data()))
    .filter((a) => a.date.startsWith(monthKey));

  const sessionsTotal = new Set(att.map((a) => a.date)).size;
  const payments = await getTuitionPaymentsForClassMonth(classId, monthKey);

  const students: TuitionStudentRow[] = roster.map((s) => {
    const mine = att.filter((a) => a.studentId === s.id);
    const attended = mine.filter((a) => a.present).length;
    const payment = payments.find((p) => p.studentId === s.id);

    return {
      studentId: s.id,
      fullName: s.fullName,
      sessionsTotal,
      sessionsAttended: attended,
      sessionsAbsent: mine.filter((a) => !a.present).length,
      feePerSession: classInfo.feePerSession,
      tuition: attended * classInfo.feePerSession,
      paymentStatus: payment?.status || 'UNPAID',
      paidAt: payment?.confirmedAt,
      transferNote: payment?.transferNote,
    };
  });

  return { classInfo, students };
};

// ===================================================================
//  DASHBOARD
// ===================================================================
export const getDashboard = async (): Promise<DashboardStats> => {
  const [studentsSnap, classesSnap, usersSnap] = await Promise.all([
    getDocs(collection(db, 'students')),
    getDocs(collection(db, 'classes')),
    getDocs(collection(db, 'users')),
  ]);

  const today = todayStr();
  const attSnap = await getDocs(
    query(collection(db, 'attendance'), where('date', '==', today))
  );
  const attToday = attSnap.docs.map((d) => d.data());

  let teachers = 0;
  let tas = 0;
  usersSnap.docs.forEach((d) => {
    const role = d.data().role as Role;
    if (role === Role.TEACHER) teachers++;
    if (role === Role.TA) tas++;
  });

  return {
    totalStudents: studentsSnap.size,
    totalClasses: classesSnap.size,
    totalTeachers: teachers,
    totalTAs: tas,
    presentToday: attToday.filter((a) => a.present === true).length,
    totalAttToday: attToday.length,
  };
};

// ===================================================================
//  PARENT REPORT (public read by studentId)
// ===================================================================
export const getStudentReport = async (
  studentId: string
): Promise<ParentReport> => {
  const student = await getStudentById(studentId);
  if (!student) throw new Error('Không tìm thấy học sinh');

  const enr = await getDocs(
    query(collection(db, 'enrollments'), where('studentId', '==', studentId))
  );
  const classIds = enr.docs.map((d) => d.data().classId as string);

  const [attSnap, scoreSnap] = await Promise.all([
    getDocs(query(collection(db, 'attendance'), where('studentId', '==', studentId))),
    getDocs(query(collection(db, 'scores'), where('studentId', '==', studentId))),
  ]);
  const allAtt = attSnap.docs.map((d) => mapAtt(d.id, d.data()));
  const allLegacyScores = scoreSnap.docs.map((d) => mapScore(d.id, d.data()));

  const classes: ParentClassReport[] = [];
  for (const cid of classIds) {
    const cls = await getClassById(cid);
    if (!cls) continue;

    const classAttAll = await getDocs(
      query(collection(db, 'attendance'), where('classId', '==', cid))
    );
    const sessionsTotal = new Set(classAttAll.docs.map((d) => d.data().date as string)).size;

    const myAtt = allAtt
      .filter((a) => a.classId === cid)
      .sort((a, b) => b.date.localeCompare(a.date));
    const attended = myAtt.filter((a) => a.present).length;

    const gradebookData = await getGradebookScoresForStudent(cid, studentId);
    const legacyScores = allLegacyScores
      .filter((s) => s.classId === cid)
      .sort((a, b) => b.date.localeCompare(a.date));

    // Nếu đã có sổ điểm mới thì ưu tiên dữ liệu mới để tránh hiện trùng điểm cũ đã migrate.
    const myScores = gradebookData.scores.length > 0 ? gradebookData.scores : legacyScores;

    classes.push({
      classId: cid,
      className: cls.className,
      subject: cls.subject,
      grade: cls.grade,
      feePerSession: cls.feePerSession,
      sessionsTotal,
      sessionsAttended: attended,
      tuition: attended * cls.feePerSession,
      scores: myScores,
      attendance: myAtt,
      average10: gradebookData.average10,
    });
  }

  return { student, classes };
};

// ===================================================================
//  FORMATTERS
// ===================================================================
export const fmtCurrency = (n: number | string | undefined) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

export const fmtDate = (d?: string) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};
