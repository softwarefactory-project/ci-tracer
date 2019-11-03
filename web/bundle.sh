#!/bin/sh -e
# Quick&Dirty bundle of react-scripts build

export URL=ci-bpf

mkdir -p build/bundle
cat build/static/css/*.css > build/bundle/ci-bpf.css
(cat build/index.html  |
     sed -e 's/^.*script.!function/!function/' -e 's#</script>.*#;#';
 echo; cat build/static/js/[0-9]*chunk.js;
 echo; cat build/static/js/main*chunk.js) | grep -v '^\/\/'  > build/bundle/ci-bpf.js
(cat public/index.html |
     sed -e "s#</head>#  <link href=\"${URL}.css\" rel=\"stylesheet\">\n  </head>#" \
         -e "s#</body>#  <script src=\"${URL}.js\"></script>\n  </body>#" ) > build/bundle/index.html
