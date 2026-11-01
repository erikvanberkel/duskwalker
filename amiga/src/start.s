| Program entry. Linked first so it sits at the start of the first code hunk.
	.section .text.unlikely
	.globl	_start
	.globl	codeStart
codeStart:
_start:
	movem.l	%d2-%d7/%a2-%a6,-(%sp)
	move.l	4.w,%a6
	cmpi.w	#37,20(%a6)			| exec lib_Version: StackSwap needs V37 (any AGA machine has V39+)
	bcs.s	1f
	lea	stackSwap,%a0			| the CLI's 4 KB default stack is far too small: run on our own
	jsr	-732(%a6)			| exec StackSwap (keeps the task's stack bounds right for exec)
	jsr	main
	move.l	%d0,%d2
	move.l	4.w,%a6
	lea	stackSwap,%a0
	jsr	-732(%a6)			| StackSwap back to the CLI stack
	move.l	%d2,%d0
	movem.l	(%sp)+,%d2-%d7/%a2-%a6
	rts
1:	moveq	#20,%d0
	movem.l	(%sp)+,%d2-%d7/%a2-%a6
	rts

| ULONG SafeCall(void *fn, ULONG arg): calls fn(arg) preserving every register. Some ROM routines (AROS)
| do not preserve all the registers gcc relies on, so every function that talks to the OS goes through here.
	.globl	SafeCall
SafeCall:
	movem.l	%d2-%d7/%a2-%a6,-(%sp)
	move.l	48(%sp),%a0
	move.l	52(%sp),-(%sp)
	jsr	(%a0)
	addq.l	#4,%sp
	movem.l	(%sp)+,%d2-%d7/%a2-%a6
	rts

| Interrupt entry stubs: save the scratch registers and call plain C bodies (sys.c).
	.globl	Level2Stub, Level3Stub
Level3Stub:
	move.l	2(%sp),irqPCin
	movem.l	%d0-%d1/%a0-%a1,-(%sp)
	jsr	Level3Body
	movem.l	(%sp)+,%d0-%d1/%a0-%a1
	move.l	2(%sp),irqPCout
	rte
Level2Stub:
	movem.l	%d0-%d1/%a0-%a1,-(%sp)
	jsr	Level2Body
	movem.l	(%sp)+,%d0-%d1/%a0-%a1
	rte

| Called through exec Supervisor(): switch on (and clear) the 68020/030 instruction cache; returns old CACR.
	.globl	EnableICache
EnableICache:
	movec	%cacr,%d0
	move.l	%d0,-(%sp)
	or.l	#0x0009,%d0
	movec	%d0,%cacr
	move.l	(%sp)+,%d0
	rte

| Called through exec Supervisor(): returns the vector base register in d0.
	.text
	.globl	ReadVbr
ReadVbr:
	movec	%vbr,%d0
	rte

#ifdef WATCHDOG
| Debug exception traps (only installed in WATCHDOG builds): show a colour per exception and stop.
	.globl	ExcGeneric, ExcBus, ExcAddr, ExcIllegal, ExcZeroDiv, ExcLineA, ExcLineF, ExcPriv, ExcTrap, ExcChk
ExcBus:		move.l	#0xb0b0b0b0,excFault
		bra	ExcCommon
ExcAddr:	move.l	16(%sp),excFault
		bra	ExcCommon
ExcIllegal:	move.l	#0x11111111,excFault
		bra	ExcCommon
ExcZeroDiv:	move.l	#0x22222222,excFault
		bra	ExcCommon
ExcLineA:	move.l	#0xaaaaaaaa,excFault
		bra	ExcCommon
ExcLineF:	move.l	#0xffffffff,excFault
		bra	ExcCommon
ExcPriv:	move.l	#0x88888888,excFault
		bra	ExcCommon
ExcTrap:	move.l	#0x77777777,excFault
		bra	ExcCommon
ExcChk:		move.l	#0x66666666,excFault
ExcGeneric:	movem.l	%d0-%d7/%a0-%a6,excRegs
		move.w	6(%sp),%d0
		and.l	#0xfff,%d0
		or.l	#0xe0000000,%d0
		move.l	%d0,excFault
ExcCommon:	movem.l	%d1-%d7/%a0-%a6,excRegs+4
		move.w	#0x2700,%sr
		move.w	(%sp),excSR+2
		move.l	%sp,excSSP
		move.l	2(%sp),excPC
		move.l	%usp,%a0
		move.l	%a0,excSP
		jmp	ExcShow

#endif
	.data
	.globl excPC, excFault, excSP, excSR, excSSP, irqPCin, irqPCout, excRegs
excPC:		.long 0
excFault:	.long 0
excSP:		.long 0
excSR:		.long 0
excSSP:		.long 0
irqPCin:	.long 0
irqPCout:	.long 0
excRegs:	.space 60
	.balign 4
stackSwap:	.long privateStack, privateStack+65536, privateStack+65536-1024	| exec StackSwapStruct

	.bss
	.balign 4
	.globl privateStack
privateStack:	.space 65536
