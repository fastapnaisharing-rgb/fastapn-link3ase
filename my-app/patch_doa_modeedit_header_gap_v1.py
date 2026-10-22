import sys,shutil,time
p=sys.argv[1]
s=open(p,encoding='utf-8').read()
M='MARKER_GL_DOA_HEADER_GAP_V1'
if M in s: print('already'); sys.exit()
shutil.copy(p,p+'.bak_header_gap_v1')
lines=s.split('\n')
i=1367
assert "{totals && <td style={{ background: '#002060', border: '1px solid #000', textAlign: 'center', whiteSpace" in lines[i]
L=lines[i]
old="position: 'sticky', top: 0, zIndex: 3 }"
n=L.count(old); assert n==4,n
L=L.replace(old,"position: 'sticky', top: 0, zIndex: 3, boxShadow: sel ? '0 2px 0 #002060' : undefined }")
L=L.replace("<tr>{totals &&","<tr>{/* "+M+" */}{totals &&",1)
lines[i]=L
open(p,'w',encoding='utf-8').write('\n'.join(lines))
print('ok')
