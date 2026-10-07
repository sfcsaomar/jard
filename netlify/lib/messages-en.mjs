// English for every message the server sends. The Arabic text stays the source; err() looks up the
// English here so each response carries both (message + messageEn) and the pages show the one that
// matches the chosen interface language. Numbers inside a message are matched as {n}.
// tests/static.test.mjs fails if a server message has no English entry.
const EN = {
  'Unknown action': 'Unknown action',
  'Method not allowed': 'Method not allowed',
  'هذا حساب إدارة الشركة. ادخل من لوحة الشركة: /company': 'This is a company admin account. Sign in from the company panel: /company',
  'هذا حساب المزوّد. ادخل من لوحة التراخيص: /admin': 'This is a provider account. Sign in from the provider panel: /admin',
  'محاولات خاطئة كثيرة. حاول بعد {n} دقيقة': 'Too many wrong attempts. Try again in {n} minutes',
  'محاولات كثيرة خاطئة. حاول بعد {n} دقيقة': 'Too many wrong attempts. Try again in {n} minutes',
  'استُنفد رصيد الذكاء الاصطناعي لهذا الشهر ({n} طلب)': 'This month\'s AI allowance is used up ({n} requests)',
  'ميزة الذكاء الاصطناعي غير مفعّلة في رخصتك': 'AI is not enabled on your licence',
  'تعذّر توليد الوصف، حاول مرة أخرى': 'Could not generate the description. Try again',
  'اسم المستخدم أو كلمة المرور غير صحيحة': 'Wrong username or password',
  'كلمة مرور الطوارئ غير صحيحة': 'Wrong emergency password',
  'صيغة البريد الإلكتروني غير صحيحة': 'The email address is not valid',
  'تغيّر البريد المسجّل لهذا الحساب بعد إرسال الرابط': 'The account\'s email changed after this link was sent',
  'الرابط غير صالح أو انتهت صلاحيته أو استُخدم من قبل. اطلب رابطًا جديدًا': 'This link is invalid, expired or already used. Ask for a new one',
  'كلمة المرور الحالية غير صحيحة': 'The current password is wrong',
  'اسم المستخدم: 3-40 حرفًا إنجليزيًا صغيرًا أو أرقامًا أو . _ -': 'Username: 3–40 lower-case English letters, digits or . _ -',
  'حساب الشركة موقوف. تواصل مع المزوّد': 'The company account is suspended. Contact your provider',
  'تجاوزت عدد الأجهزة المسموح ({n}). اطلب من مدير حساب شركتك تحرير جهاز سابق': 'Device limit reached ({n}). Ask your company admin to release an old device',
  'الجلسة لا تخص هذا الجهاز': 'This session belongs to another device',
  'هذا الجهاز غير مسجّل لهذا الحساب': 'This device is not registered for this account',
  'البريد الإلكتروني مطلوب لهذا النوع من الحسابات': 'An email address is required for this type of account',
  'هذا البريد مستخدم لحساب آخر': 'This email is already used by another account',
  'أنت داخل بكلمة الطوارئ. أنشئ حسابًا لنفسك من قائمة حسابات المزوّد': 'You are signed in with the emergency password. Create your own account under Providers',
  'لهذا المشروع أصول مرفوعة على الخادم، فلا يمكن حذفه. يمكنك إيقافه بدل الحذف': 'This project has synced assets, so it cannot be deleted. Suspend it instead',
  'احذف حسابات هذه الشركة (الأدمن والمستخدمين) أولًا': 'Delete this company\'s accounts (admins and users) first',
  'انقل مستخدمي هذا المشروع إلى مشروع آخر أولًا': 'Move this project\'s users to another project first',
  'يجب أن يبقى حساب مزوّد فعّال واحد على الأقل': 'At least one active provider account must remain',
  'لا يمكن حذف آخر مشروع في الشركة': 'The company\'s last project cannot be deleted',
  'الرخصة موقوفة. تواصل مع المزوّد': 'The licence is suspended. Contact your provider',
  'انتهت صلاحية الرخصة. تواصل مع المزوّد للتجديد': 'The licence has expired. Contact your provider to renew',
  'أدخل اسم المستخدم أو البريد الإلكتروني': 'Enter your username or email',
  'أدخل اسم المستخدم وكلمة المرور': 'Enter your username and password',
  'اسم الشركة مطلوب': 'Company name is required',
  'اسم المشروع مطلوب': 'Project name is required',
  'لا توجد شركة مرتبطة بهذا الحساب': 'No company is linked to this account',
  'لا توجد صورة': 'No image',
  'لا توجد رخصة مرتبطة بهذا الحساب': 'No licence is linked to this account',
  'أدخل بريدًا لإرسال دعوة، أو ضع كلمة مرور للحساب': 'Enter an email to send an invitation, or set a password',
  'اختر المشروع الذي سيعمل عليه المستخدم': 'Choose the project this user will work on',
  'حسابك غير مرتبط بمشروع. تواصل مع مدير حساب شركتك': 'Your account is not linked to a project. Contact your company admin',
  'لم يُفعَّل هذا الحساب بعد. افتح رابط الدعوة الذي وصلك بالبريد لتضع كلمة مرورك': 'This account is not activated yet. Open the invitation link in your email to set your password',
  'هذا حساب مستخدم ميداني. ادخل من تطبيق الجرد': 'This is a field user account. Sign in from the inventory app',
  'الحساب غير موجود': 'Account not found',
  'الشركة غير موجودة': 'Company not found',
  'المستخدم غير موجود': 'User not found',
  'المشروع غير موجود': 'Project not found',
  'هذا الحساب مفعّل، أو ليس له بريد': 'This account is already active, or has no email',
  'المشروع المرتبط بحسابك موقوف. تواصل مع مدير حساب شركتك': 'Your project is suspended. Contact your company admin',
  'لا يمكنك إيقاف حسابك وأنت داخل به': 'You cannot suspend the account you are signed in with',
  'لا يمكنك حذف حسابك وأنت داخل به': 'You cannot delete the account you are signed in with',
  'الخادم غير متاح مؤقتًا، حاول بعد قليل': 'The server is temporarily unavailable. Try again shortly',
  'الخادم غير مهيأ للذكاء الاصطناعي': 'The server is not set up for AI',
  'انتهت الجلسة. سجّل الدخول مجددًا': 'Your session ended. Sign in again',
  'تعذّر الاتصال بخادم التخزين، حاول لاحقًا': 'Could not reach photo storage. Try later',
  'تعذّر الاتصال بخادم البيانات': 'Could not reach the database',
  'تعذّر الاتصال بخادم التخزين': 'Could not reach photo storage',
  'تعذّر الاتصال بخادم التخزين، ستُعاد المحاولة تلقائيًا': 'Could not reach photo storage; it will retry automatically',
  'المزامنة غير مفعّلة على الخادم': 'Sync is not enabled on the server',
  'الصورة كبيرة جدًا': 'The image is too large',
  'طلبات كثيرة دفعة واحدة': 'Too many requests at once',
  'هذا الحساب موقوف. تواصل مع المزوّد': 'This account is suspended. Contact your provider',
  'وصلت الرخصة للحد الأعلى من المستخدمين': 'The licence has reached its user limit',
  'وصلت الرخصة للحد الأعلى من المستخدمين ({n})': 'The licence has reached its user limit ({n})',
  'اسم المستخدم مستخدم لحساب آخر. اختر اسمًا مختلفًا': 'This username is taken. Choose another',
  'اسم المستخدم مستخدم لحساب من نوع آخر في نفس الشركة': 'This username is used by another type of account in this company',
  'اسم المستخدم مستخدم لدى جهة أخرى. اختر اسمًا مختلفًا': 'This username is taken by another organisation. Choose another',
  'أدخل مبلغًا صحيحًا بالدولار': 'Enter a valid amount in US dollars',
  'كلمة المرور {n} أحرف على الأقل': 'The password needs at least {n} characters',
  'إذا كان الحساب موجودًا وله بريد مؤكَّد، فستصلك رسالة خلال دقائق. المستخدم الذي ليس له بريد يطلب من مدير حساب شركته إعادة تعيين كلمة مروره.':
    'If the account exists and has a confirmed email, a message will arrive within minutes. A user without an email should ask their company admin to reset the password.'
};

// Returns the English for an Arabic server message, or '' if there is none.
export function toEnglish(message) {
  const s = String(message ?? '');
  if (EN[s]) return EN[s];
  const nums = [];
  const key = s.replace(/\d+/g, (d) => { nums.push(d); return '{n}'; });
  const t = EN[key];
  return t ? t.replace(/\{n\}/g, () => nums.shift()) : '';
}

export const _allEnglishKeys = () => Object.keys(EN);
