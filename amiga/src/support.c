// Freestanding C runtime bits gcc may call on its own.
typedef unsigned long size_t;

void *memcpy(void *dst, const void *src, size_t n) {
	unsigned char *d = dst;
	const unsigned char *s = src;
	if ((((unsigned long)d | (unsigned long)s | n) & 3) == 0) {
		unsigned long *dl = (unsigned long *)d;
		const unsigned long *sl = (const unsigned long *)s;
		for (n >>= 2; n; n--) *dl++ = *sl++;
		return dst;
	}
	while (n--) *d++ = *s++;
	return dst;
}

void *memset(void *dst, int c, size_t n) {
	unsigned char *d = dst;
	if ((((unsigned long)d | n) & 3) == 0) {
		unsigned long v = (unsigned char)c;
		v |= v << 8; v |= v << 16;
		unsigned long *dl = (unsigned long *)d;
		for (n >>= 2; n; n--) *dl++ = v;
		return dst;
	}
	while (n--) *d++ = (unsigned char)c;
	return dst;
}

void *memmove(void *dst, const void *src, size_t n) {
	unsigned char *d = dst;
	const unsigned char *s = src;
	if (d < s) while (n--) *d++ = *s++;
	else { d += n; s += n; while (n--) *--d = *--s; }
	return dst;
}
